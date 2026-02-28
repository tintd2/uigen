// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

// --- Cookie store mock ---
const cookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(cookieStore)),
}));

// Import after mocks are set up
import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
} from "@/lib/auth";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(
  payload: object,
  /** Pass a numeric Unix timestamp (seconds) or a jose duration string like "7d". */
  expiration: number | string = "7d"
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiration)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

/** Returns a token whose exp is 60 seconds in the past. */
function makeExpiredToken(payload: object): Promise<string> {
  return makeToken(payload, Math.floor(Date.now() / 1000) - 60);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe("createSession", () => {
  test("sets an httpOnly cookie named auth-token", async () => {
    await createSession("user-1", "user@example.com");

    expect(cookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = cookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
  });

  test("cookie value is a valid JWT containing userId and email", async () => {
    const { jwtVerify } = await import("jose");
    await createSession("user-42", "hello@test.com");

    const token = cookieStore.set.mock.calls[0][1] as string;
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("user-42");
    expect(payload.email).toBe("hello@test.com");
  });

  test("cookie expires roughly 7 days from now", async () => {
    const before = Date.now();
    await createSession("u", "u@u.com");
    const after = Date.now();

    const expires: Date = cookieStore.set.mock.calls[0][2].expires;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------
describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    cookieStore.get.mockReturnValue(undefined);
    expect(await getSession()).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const payload = {
      userId: "user-7",
      email: "test@example.com",
      expiresAt: new Date(Date.now() + 86400_000),
    };
    const token = await makeToken(payload);
    cookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session?.userId).toBe("user-7");
    expect(session?.email).toBe("test@example.com");
  });

  test("returns null for an expired token", async () => {
    const token = await makeExpiredToken({ userId: "u", email: "u@u.com" });
    cookieStore.get.mockReturnValue({ value: token });
    expect(await getSession()).toBeNull();
  });

  test("returns null for a malformed token string", async () => {
    cookieStore.get.mockReturnValue({ value: "not.a.jwt" });
    expect(await getSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------
describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(cookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

// ---------------------------------------------------------------------------
// verifySession
// ---------------------------------------------------------------------------
describe("verifySession", () => {
  function makeRequest(token?: string) {
    const cookies = {
      get: vi.fn((name: string) =>
        name === "auth-token" && token ? { value: token } : undefined
      ),
    };
    return { cookies } as any;
  }

  test("returns null when request has no auth-token cookie", async () => {
    expect(await verifySession(makeRequest())).toBeNull();
  });

  test("returns session payload for a valid token in the request", async () => {
    const payload = { userId: "req-user", email: "req@example.com" };
    const token = await makeToken(payload);

    const session = await verifySession(makeRequest(token));
    expect(session?.userId).toBe("req-user");
    expect(session?.email).toBe("req@example.com");
  });

  test("returns null for an expired token in the request", async () => {
    const token = await makeExpiredToken({ userId: "u", email: "u@u.com" });
    expect(await verifySession(makeRequest(token))).toBeNull();
  });

  test("returns null for a malformed token in the request", async () => {
    expect(await verifySession(makeRequest("garbage"))).toBeNull();
  });
});
