import { describe, expect, it } from "vitest";
import { normalizePanelUrl, clampWindowBounds } from "../policy.cjs";

describe("native companion panel origin policy", () => {
  it("accepts explicit literal loopback HTTP origins and normalizes their root URL", () => {
    expect(normalizePanelUrl()).toBe("http://127.0.0.1:47831/");
    expect(normalizePanelUrl("http://127.0.0.1:47831")).toBe("http://127.0.0.1:47831/");
    expect(normalizePanelUrl("http://[::1]:47831/")).toBe("http://[::1]:47831/");
    expect(normalizePanelUrl("http://127.0.0.1:80/")).toBe("http://127.0.0.1/");
  });
  it("rejects remote, ambiguous, credentialed, redirected and non-HTTP targets", () => {
    for (const url of [
      "file:///C:/panel.html", "javascript:alert(1)", "https://127.0.0.1:47831/",
      "http://192.168.0.24:47831/", "http://localhost:47831/", "http://127.1:47831/",
      "http://2130706433:47831/", "http://127.0.0.1.evil.test:47831/", "http://[::ffff:127.0.0.1]:47831/",
      "http://127.0.0.1/", "http://127.0.0.1:0/", "http://127.0.0.1:65536/",
      "http://user:pass@127.0.0.1:47831/", "http://127.0.0.1:47831@evil.test/",
      "http://127.0.0.1:47831/?next=https://evil.test", "http://127.0.0.1:47831/#target",
      "http://127.0.0.1:47831/?", "http://127.0.0.1:47831/#", "http://127.0.0.1:47831/companion",
      "http://127.0.0.1:47831/%2e%2e/", "http://127.0.0.1:47831//evil.test", " http://127.0.0.1:47831/",
    ]) expect(() => normalizePanelUrl(url), url).toThrow();
  });
});
describe("native companion monitor placement", () => {
  const primary = {workArea:{x:0,y:0,width:1920,height:1040}};
  it("defaults to a fixed 300 by 620 window at the work area's bottom right with 16px margin", () => {
    expect(clampWindowBounds(null,primary)).toEqual({x:1604,y:404,width:300,height:620});
    for (const saved of [{x:NaN,y:200},{x:100,y:Infinity},{x:"12",y:200},[],"bad"]) {
      expect(clampWindowBounds(saved,primary)).toEqual({x:1604,y:404,width:300,height:620});
    }
  });
  it("retains valid coordinates but ignores saved dimensions and clamps removed-monitor positions", () => {
    expect(clampWindowBounds({x:100,y:200,width:9999,height:9999},primary)).toEqual({x:100,y:200,width:300,height:620});
    expect(clampWindowBounds({x:-1920,y:3000},primary)).toEqual({x:0,y:420,width:300,height:620});
  });
  it("supports monitors left of and above the primary display", () => {
    const secondary = {workArea:{x:-1600,y:-900,width:1600,height:900}};
    expect(clampWindowBounds({x:-1400,y:-800},secondary)).toEqual({x:-1400,y:-800,width:300,height:620});
    expect(clampWindowBounds({x:500,y:500},secondary)).toEqual({x:-300,y:-620,width:300,height:620});
    expect(clampWindowBounds(null,secondary)).toEqual({x:-316,y:-636,width:300,height:620});
  });
  it("fits tiny work areas and rejects invalid display geometry", () => {
    expect(clampWindowBounds({x:900,y:900},{workArea:{x:-80,y:20,width:200,height:300}})).toEqual({x:-80,y:20,width:200,height:300});
    expect(clampWindowBounds(null,{workArea:{x:0,y:0,width:305,height:625}})).toEqual({x:3,y:3,width:300,height:620});
    expect(()=>clampWindowBounds(null,{workArea:{x:0,y:0,width:Infinity,height:600}})).toThrow();
    expect(()=>clampWindowBounds(null,{workArea:{x:0,y:0,width:0,height:600}})).toThrow();
  });
});
