// Guards the text colour tokens against dropping below WCAG AA (4.5:1).
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import config from "../../../tailwind.config.ts";
import { contrastRatio } from "./contrast.ts";

const brand = (config.theme?.extend?.colors as { brand: Record<string, string> }).brand;
const WHITE = "#FFFFFF";

test("contrastRatio matches known WCAG values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(2), "21.00");
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF").toFixed(2), "1.00");
});

test("body text tokens reach 4.5:1 on white and on the page background", () => {
  for (const token of ["ink", "ink-muted", "ink-subtle"]) {
    for (const bg of [WHITE, brand.bg!]) {
      const ratio = contrastRatio(brand[token]!, bg);
      assert.ok(ratio >= 4.5, `${token} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("ink-subtle stays visibly subtler than ink-muted", () => {
  assert.ok(contrastRatio(brand["ink-subtle"]!, brand.bg!) < contrastRatio(brand["ink-muted"]!, brand.bg!) - 1.5);
});

test("status text tokens reach 4.5:1 on their own tinted backgrounds", () => {
  assert.ok(contrastRatio(brand.success!, brand["success-bg"]!) >= 4.5);
  assert.ok(contrastRatio(brand["ink-muted"]!, brand.chip!) >= 4.5);
});
