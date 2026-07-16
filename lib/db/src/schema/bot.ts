import {
  pgTable,
  bigint,
  text,
  boolean,
  timestamp,
  serial,
} from "drizzle-orm/pg-core";

// ── Users ─────────────────────────────────────────────────────────────────────
export const botUsers = pgTable("bot_users", {
  chatId:    bigint("chat_id",    { mode: "number" }).primaryKey(),
  username:  text("username"),
  firstSeen: timestamp("first_seen").notNull().defaultNow(),
  lastSeen:  timestamp("last_seen").notNull().defaultNow(),
  banned:    boolean("banned").notNull().default(false),
});

export type BotUser = typeof botUsers.$inferSelect;

// ── Licenses ──────────────────────────────────────────────────────────────────
export const botLicenses = pgTable("bot_licenses", {
  key:             text("key").primaryKey(),
  durationMs:      bigint("duration_ms",  { mode: "number" }).notNull(),
  createdBy:       bigint("created_by",   { mode: "number" }).notNull(),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  redeemedBy:      bigint("redeemed_by",  { mode: "number" }),
  redeemedAt:      timestamp("redeemed_at"),
  expiresAt:       timestamp("expires_at"),
  active:          boolean("active").notNull().default(true),
  notifiedExpiry:  boolean("notified_expiry").notNull().default(false),
});

export type BotLicense = typeof botLicenses.$inferSelect;

// ── Settings (key-value) ──────────────────────────────────────────────────────
export const botSettings = pgTable("bot_settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Call logs ─────────────────────────────────────────────────────────────────
export const botCallLogs = pgTable("bot_call_logs", {
  id:        serial("id").primaryKey(),
  chatId:    bigint("chat_id", { mode: "number" }).notNull(),
  username:  text("username"),
  mode:      text("mode").notNull().default("call"),
  phone:     text("phone").notNull(),
  callSid:   text("call_sid"),
  status:    text("status").notNull().default("initiated"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BotCallLog = typeof botCallLogs.$inferSelect;
