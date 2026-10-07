import test from "node:test";
import assert from "node:assert/strict";
import {
  messagesHref,
  parseMessagePage,
  parseMessageQuery,
  parseMessageTab,
} from "./adminMessagesView.ts";

test("tab defaults to open and rejects unknown values", () => {
  assert.equal(parseMessageTab(undefined), "open");
  assert.equal(parseMessageTab("bogus"), "open");
  assert.equal(parseMessageTab("resolved"), "resolved");
  assert.equal(parseMessageTab("all"), "all");
});

test("page defaults to 1 for junk, zero and negatives", () => {
  assert.equal(parseMessagePage(undefined), 1);
  assert.equal(parseMessagePage("abc"), 1);
  assert.equal(parseMessagePage("0"), 1);
  assert.equal(parseMessagePage("-3"), 1);
  assert.equal(parseMessagePage("4"), 4);
});

test("search text is trimmed and capped at 100 characters", () => {
  assert.equal(parseMessageQuery(undefined), "");
  assert.equal(parseMessageQuery("  hello  "), "hello");
  assert.equal(parseMessageQuery("x".repeat(250)).length, 100);
});

test("href omits defaults and encodes the search text", () => {
  assert.equal(messagesHref("open", 1, ""), "/admin/messages");
  assert.equal(messagesHref("resolved", 1, ""), "/admin/messages?status=resolved");
  assert.equal(messagesHref("all", 3, "a b&c"), "/admin/messages?status=all&q=a+b%26c&page=3");
  assert.equal(messagesHref("open", 2, ""), "/admin/messages?page=2");
});
