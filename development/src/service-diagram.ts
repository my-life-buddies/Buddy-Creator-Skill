import { subscriptionPrice } from "./subscription.js";
import { SERVICE_STAGE_MEANINGS } from "./service-policy.js";

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const lines = (value: unknown, length = 17) =>
  String(value ?? "").match(new RegExp(`.{1,${length}}`, "gu")) ?? [];

export function serviceDiagram(data: Record<string, unknown>, buddyId: string) {
  const stages = (data.stages ?? {}) as Record<string, Record<string, unknown>>;
  const cardHeight = Math.max(
    470,
    ...Object.entries(SERVICE_STAGE_MEANINGS).map(
      ([id, meaning]) =>
        138 + lines(meaning.detail).length * 21 +
        ["goal", "result", "service", "limit"].reduce(
          (height, key) => height + 48 + lines(stages[id]?.[key]).length * 21,
          0,
        ),
    ),
  );
  const bottom = 110 + cardHeight,
    height = bottom + 240;
  const text = (
    x: number,
    y: number,
    value: unknown,
    size = 14,
    color = "#a5b8ab",
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escape(value)}</text>`;
  const cards = ["acquisition", "paid", "maintenance"]
    .map((key, index) => {
      const stage = stages[key] ?? {},
        x = 40 + index * 360;
      let y = 173;
      const content = [
        [SERVICE_STAGE_MEANINGS[key as keyof typeof SERVICE_STAGE_MEANINGS].plain, SERVICE_STAGE_MEANINGS[key as keyof typeof SERVICE_STAGE_MEANINGS].detail],
        ["服务目标", stage.goal],
        ["用户得到", stage.result],
        ["提供的服务", stage.service],
        ["范围与限制", stage.limit],
      ]
        .map(([label, value]) => {
          const result =
            text(x + 24, y, label, 12) +
            "\n" +
            lines(value)
              .map((line, n) =>
                text(x + 24, y + 25 + n * 21, line, 14, "#e4eee6"),
              )
              .join("\n");
          y += 48 + lines(value).length * 21;
          return result;
        })
        .join("\n");
      return `<rect x="${x}" y="110" width="310" height="${cardHeight}" rx="18" fill="#15211b" stroke="#465c4c"/>${text(x + 24, 148, ["01 免费体验", "02 订阅服务", "03 停付维持"][index], 19, "#b9e2b6")}${content}`;
    })
    .join("\n");
  const arrow = (
    path: string,
    label: string,
    x: number,
    y: number,
    dashed = false,
  ) =>
    `<path d="${path}" fill="none" stroke="#90b895" stroke-width="2" marker-end="url(#arrow)" ${dashed ? 'stroke-dasharray="7 6"' : ""}/>${text(x, y, label, 13, "#c8dec9")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${height}" viewBox="0 0 1120 ${height}" role="img" aria-label="Buddy 三阶段五动线服务模式">
<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#90b895"/></marker></defs>
<rect width="1120" height="${height}" fill="#0e1712"/><g font-family="system-ui, sans-serif">
${text(40, 45, `Buddy ${buddyId} · 服务模式`, 24, "#f0f5ef")}${text(40, 75, `单档订阅 · ${subscriptionPrice(data.price, data.billingCycle)} · ${data.deliveries || "交付待确认"}`)}
${cards}
${arrow("M350 230 H400", "订阅", 356, 216)}${arrow("M710 230 H760", "停付", 716, 216)}
${arrow("M500 110 V91 H610 V110", "续费", 539, 86)}
${arrow(`M195 ${bottom} V${bottom + 55} H915 V${bottom}`, "体验后未订阅", 475, bottom + 42)}
${arrow(`M915 ${bottom} V${bottom + 112} H555 V${bottom}`, "恢复订阅 · 默认继承历史并恢复完整服务", 570, bottom + 144, true)}
${text(40, height - 45, "免费体验由创作者定义；付费期与搭子对话不限次数；维持期保留基础对话，已购期间继续履约。", 14)}
</g></svg>`;
}
