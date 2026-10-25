import { marketRequest, setMarketAccountId } from "./market.js";

type MarketCredentials = { email: string; password: string };
type PrivateUser = { id?: string; slug?: string; ingameName?: string; verification?: boolean };
type LegacyLogin = { jwt?: string; token?: string; user?: { id?: string; ingame_name?: string } };

type MarketSession = { token: string; user: PrivateUser; verified: boolean };
let session: MarketSession | null = null;

export function marketAccountStatus() {
  if (!session) return { connected: false, verified: false, accountName: null };
  return { connected: true, verified: session.verified, accountName: session.user.ingameName ?? session.user.slug ?? "warframe.market user" };
}

export function marketSessionToken() {
  return session?.token ?? null;
}

export function marketAccountId() {
  return session?.user.id ?? null;
}

export async function connectMarketAccount(credentials: MarketCredentials) {
  const email = credentials.email.trim();
  if (email.length > 128 || credentials.password.length < 1 || credentials.password.length > 128) throw new Error("Enter a valid warframe.market email and password.");
  const responseAuthorization: { value: string | null } = { value: null };
  const login = await marketRequest<LegacyLogin>("/auth/signin", {
    method: "POST",
    legacy: true,
    headers: { Authorization: "JWT", Platform: "pc" },
    onResponseHeaders: (headers) => { responseAuthorization.value = headers.get("authorization"); },
    body: { email, password: credentials.password, auth_type: "header" }
  });
  const token = responseAuthorization.value?.replace(/^(JWT|Bearer)\s+/i, "") ?? login.jwt ?? login.token;
  if (!token || token.length > 8192) throw new Error("warframe.market did not return an API session. Check the account details or try again later.");
  const profile = await marketRequest<PrivateUser>("/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!profile || typeof profile !== "object") throw new Error("warframe.market could not verify the signed-in account.");
  session = { token, user: profile, verified: profile.verification === true };
  setMarketAccountId(profile.id ?? login.user?.id ?? null);
  return marketAccountStatus();
}

export async function disconnectMarketAccount() {
  const token = session?.token;
  session = null;
  setMarketAccountId(null);
  if (!token) return { connected: false, verified: false, accountName: null };
  try { await marketRequest<unknown>("/auth/signout", { method: "POST", legacy: true, headers: { Authorization: `JWT ${token}`, Platform: "pc" } }); } catch { }
  return { connected: false, verified: false, accountName: null };
}

export function clearMarketAccount() {
  session = null;
  setMarketAccountId(null);
}

export type MarketOrder = { id: string; itemId?: string; item?: { id?: string }; type: "sell" | "buy"; platinum: number; quantity: number; perTrade?: number; visible: boolean };

export async function getMyMarketOrders() {
  const token = session?.token;
  if (!token) throw new Error("Connect your warframe.market account first.");
  const orders = await marketRequest<MarketOrder[]>("/orders/my", { headers: { Authorization: `Bearer ${token}` } });
  return orders.map((order) => ({ ...order, itemId: order.itemId ?? order.item?.id }));
}

export async function createMarketOrder(order: { itemId: string; platinum: number; quantity: number; visible: boolean }) {
  const token = session?.token;
  if (!token) throw new Error("Connect your warframe.market account first.");
  if (!session?.verified) throw new Error("Verify your warframe.market account before publishing orders.");
  return marketRequest<MarketOrder>("/order", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: { ...order, type: "sell" } });
}

export async function updateMarketOrder(orderId: string, update: { platinum: number; quantity: number }) {
  const token = session?.token;
  if (!token) throw new Error("Connect your warframe.market account first.");
  if (!session?.verified) throw new Error("Verify your warframe.market account before publishing orders.");
  return marketRequest<MarketOrder>(`/order/${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: update });
}
