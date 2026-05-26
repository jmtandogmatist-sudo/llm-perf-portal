import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user: User | null = { id: 1, openId: 'local_mock', role: 'admin', name: 'Local Tester', email: null, loginMethod: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
