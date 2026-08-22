export type NotificationMetricName =
  | "monitor_leases"
  | "monitor_rebaselines"
  | "catalog_sync_failures"
  | "subscription_rejections"
  | "upstream_utilization_percent"
  | "outbox_pending"
  | "delivery_attempts"
  | "delivery_accepted"
  | "delivery_rejected"
  | "delivery_unknown"
  | "receipt_pending"
  | "receipt_failed";

export interface NotificationMetricLabels {
  readonly network?: "testnet" | "mainnet";
  readonly provider?: "expo";
  readonly outcome?: "accepted" | "rejected" | "unknown";
}

export interface NotificationMetricSample {
  readonly name: NotificationMetricName;
  readonly value: number;
  readonly labels: NotificationMetricLabels;
}

const METRICS = new Set<NotificationMetricName>([
  "monitor_leases",
  "monitor_rebaselines",
  "catalog_sync_failures",
  "subscription_rejections",
  "upstream_utilization_percent",
  "outbox_pending",
  "delivery_attempts",
  "delivery_accepted",
  "delivery_rejected",
  "delivery_unknown",
  "receipt_pending",
  "receipt_failed",
]);
const LABEL_KEYS = new Set(["network", "provider", "outcome"]);

export class BoundedNotificationMetrics {
  readonly #samples = new Map<string, NotificationMetricSample>();

  increment(
    name: NotificationMetricName,
    labels: NotificationMetricLabels = {},
    amount = 1,
  ): void {
    validate(name, labels, amount);
    const key = sampleKey(name, labels);
    const existing = this.#samples.get(key);
    this.#samples.set(key, {
      name,
      value: (existing?.value ?? 0) + amount,
      labels: { ...labels },
    });
  }

  set(
    name: NotificationMetricName,
    value: number,
    labels: NotificationMetricLabels = {},
  ): void {
    validate(name, labels, value);
    this.#samples.set(sampleKey(name, labels), {
      name,
      value,
      labels: { ...labels },
    });
  }

  snapshot(): readonly NotificationMetricSample[] {
    return Array.from(this.#samples.values(), (sample) => ({
      ...sample,
      labels: { ...sample.labels },
    }));
  }
}

function validate(
  name: NotificationMetricName,
  labels: NotificationMetricLabels,
  value: number,
): void {
  if (!METRICS.has(name)) throw new Error("notification metric is invalid");
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("notification metric value is invalid");
  }
  const record = labels as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => !LABEL_KEYS.has(key))) {
    throw new Error("notification metric label is invalid");
  }
  if (
    (labels.network !== undefined &&
      labels.network !== "testnet" &&
      labels.network !== "mainnet") ||
    (labels.provider !== undefined && labels.provider !== "expo") ||
    (labels.outcome !== undefined &&
      !["accepted", "rejected", "unknown"].includes(labels.outcome))
  ) {
    throw new Error("notification metric label is invalid");
  }
}

function sampleKey(
  name: NotificationMetricName,
  labels: NotificationMetricLabels,
): string {
  return `${name}|${labels.network ?? ""}|${labels.provider ?? ""}|${labels.outcome ?? ""}`;
}
