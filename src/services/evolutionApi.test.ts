import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createInstance,
  connectInstance,
  getConnectionState,
  deleteInstance,
  sendTextMessage,
} from "./evolutionApi";

const MOCK_TOKEN = "test-access-token";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-access-token" } },
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-access-token-refreshed" } },
      }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

function mockFetchSuccess(data: unknown) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, statusText: string) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  });
}

function mockFetchNetworkError() {
  (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
    new TypeError("Failed to fetch")
  );
}

/** Helper to extract the fetch call arguments */
function getFetchCallArgs() {
  const mockFetch = fetch as ReturnType<typeof vi.fn>;
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, options] = mockFetch.mock.calls[0];
  const parsedBody = options?.body
    ? JSON.parse(options.body as string)
    : undefined;
  return { url: url as string, options, parsedBody };
}

describe("evolutionApi (proxy-based)", () => {
  describe("createInstance", () => {
    it("sends POST to proxy with correct path, method, and body", async () => {
      const responseData = {
        instance: { instanceName: "test-inst", status: "created" },
        qrcode: { base64: "base64-qr-data" },
      };
      mockFetchSuccess(responseData);

      const result = await createInstance("test-inst");

      const { url, options, parsedBody } = getFetchCallArgs();
      expect(url).toContain("/functions/v1/evolution-proxy");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(options.headers["apikey"]).toBeDefined();
      expect(parsedBody).toEqual({
        path: "instance/create",
        method: "POST",
        body: {
          instanceName: "test-inst",
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          rejectCall: true,
          msgCall: "Não posso atender agora. Me chama no Zap por texto 🙂",
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
          webhook: {
            url: "https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/evolution-webhook",
            byEvents: false,
            base64: true,
            enabled: true,
            events: [
              "MESSAGES_UPSERT",
              "MESSAGES_UPDATE",
              "CONNECTION_UPDATE",
            ],
          },
        },
      });
      expect(result).toEqual(responseData);
    });
  });

  describe("connectInstance", () => {
    it("sends GET via proxy for instance connect", async () => {
      const responseData = { base64: "qr-code-base64" };
      mockFetchSuccess(responseData);

      const result = await connectInstance("my-instance");

      const { url, options, parsedBody } = getFetchCallArgs();
      expect(url).toContain("/functions/v1/evolution-proxy");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(parsedBody).toEqual({
        path: "instance/connect/my-instance",
        method: "GET",
      });
      expect(result).toEqual({ base64: "qr-code-base64", pairingCode: null });
    });
  });

  describe("getConnectionState", () => {
    it("sends GET via proxy for connection state", async () => {
      const responseData = { state: "open" };
      mockFetchSuccess(responseData);

      const result = await getConnectionState("my-instance");

      const { url, options, parsedBody } = getFetchCallArgs();
      expect(url).toContain("/functions/v1/evolution-proxy");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(parsedBody).toEqual({
        path: "instance/connectionState/my-instance",
        method: "GET",
      });
      expect(result).toEqual({ state: "open" });
    });
  });

  describe("deleteInstance", () => {
    it("sends DELETE via proxy for instance deletion", async () => {
      mockFetchSuccess(undefined);

      await deleteInstance("my-instance");

      const { url, options, parsedBody } = getFetchCallArgs();
      expect(url).toContain("/functions/v1/evolution-proxy");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(parsedBody).toEqual({
        path: "instance/delete/my-instance",
        method: "DELETE",
      });
    });
  });

  describe("sendTextMessage", () => {
    it("sends POST via proxy with phone and text in body", async () => {
      const responseData = { key: { id: "msg-123" } };
      mockFetchSuccess(responseData);

      const result = await sendTextMessage(
        "my-instance",
        "5511999999999",
        "Hello!"
      );

      const { url, options, parsedBody } = getFetchCallArgs();
      expect(url).toContain("/functions/v1/evolution-proxy");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe(`Bearer ${MOCK_TOKEN}`);
      expect(parsedBody).toEqual({
        path: "message/sendText/my-instance",
        method: "POST",
        body: { number: "5511999999999", text: "Hello!" },
      });
      expect(result).toEqual(responseData);
    });
  });

  describe("error handling", () => {
    it("throws authentication error on 401 response", async () => {
      // 1st call: original request → 401
      // 2nd call: retry after token refresh → 401
      // After two 401s the code signs out and throws EvolutionAuthError
      // But getAccessToken(true) calls refreshSession which returns a token,
      // so we need the fetch mock to handle both proxy calls returning 401
      const mock401 = { ok: false, status: 401, statusText: "Unauthorized", json: () => Promise.resolve({}) };
      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mock401)
        .mockResolvedValueOnce(mock401);

      await expect(createInstance("test")).rejects.toThrow(
        "Sessão expirada"
      );
    });

    it("throws network error on TypeError (fetch failure)", async () => {
      mockFetchNetworkError();

      await expect(getConnectionState("test")).rejects.toThrow(
        "Erro de conexão. Verifique sua internet."
      );
    });

    it("throws statusText on other HTTP errors", async () => {
      mockFetchError(500, "Internal Server Error");

      await expect(sendTextMessage("inst", "123", "hi")).rejects.toThrow(
        "Internal Server Error"
      );
    });
  });
});
