import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutSection, deliveryPlaces, splitVenueName, townFromAddress } from "./about-section";
import { menuCopy } from "@/lib/i18n/menu";

const areas = [
  { zip: "78462", locality: "Konstanz", feeCents: 0, minCents: 0, freeOverCents: 0 },
  { zip: "78464", locality: "Konstanz", feeCents: 0, minCents: 0, freeOverCents: 0 },
];

describe("About section", () => {
  it("reads name, town and delivery places from the settings", () => {
    expect(splitVenueName("Rangla Punjab Restaurant · Konstanz")).toEqual({
      name: "Rangla Punjab Restaurant",
      cityFromName: "Konstanz",
    });
    expect(townFromAddress("Musterstr. 1\n78462 Konstanz")).toBe("Konstanz");
    expect(townFromAddress("Musterstr. 1")).toBeNull();
    expect(deliveryPlaces(areas)).toBe("Konstanz (78462, 78464)");
    expect(deliveryPlaces([])).toBeNull();
  });

  it("says only what is switched on", () => {
    const html = renderToStaticMarkup(
      <AboutSection
        t={menuCopy("de")}
        venueName="Rangla Punjab Restaurant · Konstanz"
        postalAddress={null}
        cuisine="indische und pakistanische Küche"
        dishes={["Biryani", "Naan"]}
        takeaway
        delivery
        deliveryAreas={areas}
        reservations={false}
      />,
    );
    expect(html).toContain("Rangla Punjab Restaurant in Konstanz");
    expect(html).toContain("indische und pakistanische Küche in Konstanz");
    expect(html).toContain("Wir liefern nach Konstanz (78462, 78464).");
    expect(html).not.toContain("Reservieren");
    expect(html).not.toContain("Sie finden uns");
  });
});
