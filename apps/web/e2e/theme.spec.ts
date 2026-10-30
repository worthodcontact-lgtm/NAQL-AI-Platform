import { expect, test } from "@playwright/test";

test("theme preference toggles across the public site and persists after reload", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: /التبديل إلى الوضع الداكن/ });

  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("naql-theme"))).toBe("dark");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /التبديل إلى الوضع الفاتح/ }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
});

test("public homepage navigation remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /تجارة عالمية/ })).toBeVisible();
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await expect(page.getByRole("navigation", { name: "التنقل للجوال" })).toBeVisible();
  await expect(page.getByRole("link", { name: "الخدمات" })).toHaveAttribute("href", "/#services");
  await expect(page.getByRole("link", { name: "عن المنصة" })).toHaveAttribute("href", "/#about");

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
