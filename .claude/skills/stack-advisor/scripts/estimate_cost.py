#!/usr/bin/env python3
"""
스택 비용 시뮬레이터 — 3개 규모 시점의 현금 비용 + 시간 비용 합산표를 만든다.

사용:
  python estimate_cost.py --profile profile.json --pricing pricing.json \
      --stack "hetzner-cx22,coolify-postgres,cloudflare-r2" \
      [--hourly-rate 30000] [--fx 1400] [--cap-usd 200] [--json]

profile.json — 규모 시점별 월 사용량. 키 이름은 pricing의 metered 키와 맞춘다.
  {
    "hourly_rate_krw": 30000,
    "fx_krw_per_usd": 1400,
    "scale_points": [
      {"name": "출시 직후", "usage": {"requests_m": 0.1, "egress_gb": 5, "storage_gb": 2, "db_gb": 0.2, "mau": 20, "emails": 200}},
      ...
    ]
  }

pricing.json — 옵션별 단가. 조사한 값으로 채운다. 모든 금액은 USD, 월 기준.
  {
    "options": {
      "hetzner-cx22": {
        "layer": "hosting",
        "label": "Hetzner CX22",
        "fixed_monthly": 4.2,
        "metered": {"egress_gb": {"included": 20000, "per_unit": 0.0012}},
        "ops_hours_per_month": 3,
        "free_tier_commercial": true,
        "spend_cap": true,
        "note": "…",
        "source": "https://… (2026-09-15)"
      }
    }
  }

metered 규칙: 사용량이 included를 넘는 만큼 per_unit을 곱한다.
계단식 요금(예: MAU 1만 초과 시 플랜 점프)은 "tiers": [{"up_to": 10000, "fixed": 0}, {"up_to": null, "fixed": 25}] 로 적는다.
"""
import argparse
import json
import sys


def metered_cost(spec, usage_value):
    included = spec.get("included", 0)
    per_unit = spec.get("per_unit", 0)
    over = max(0.0, usage_value - included)
    return over * per_unit


def tier_fixed(tiers, usage_value):
    for t in tiers:
        if t.get("up_to") is None or usage_value <= t["up_to"]:
            return t.get("fixed", 0)
    return tiers[-1].get("fixed", 0)


def option_cost(opt, usage):
    cash = float(opt.get("fixed_monthly", 0))
    for metric, spec in opt.get("metered", {}).items():
        cash += metered_cost(spec, float(usage.get(metric, 0)))
    for metric, tiers in opt.get("tiers", {}).items():
        cash += tier_fixed(tiers, float(usage.get(metric, 0)))
    return cash


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--pricing", required=True)
    ap.add_argument("--stack", required=True, help="쉼표로 구분한 옵션 id")
    ap.add_argument("--hourly-rate", type=float, help="원/시간 (profile 값 덮어씀)")
    ap.add_argument("--fx", type=float, help="원/달러 (profile 값 덮어씀)")
    ap.add_argument("--cap-usd", type=float, default=200)
    ap.add_argument("--json", action="store_true", help="표 대신 JSON 출력")
    args = ap.parse_args()

    with open(args.profile, encoding="utf-8") as f:
        profile = json.load(f)
    with open(args.pricing, encoding="utf-8") as f:
        pricing = json.load(f)["options"]

    hourly = args.hourly_rate or profile.get("hourly_rate_krw", 30000)
    fx = args.fx or profile.get("fx_krw_per_usd", 1400)
    ids = [s.strip() for s in args.stack.split(",") if s.strip()]
    missing = [i for i in ids if i not in pricing]
    if missing:
        sys.exit(f"pricing.json에 없는 옵션: {', '.join(missing)}")

    rows = []
    for sp in profile["scale_points"]:
        usage = sp.get("usage", {})
        per_option = []
        cash = 0.0
        hours = 0.0
        for i in ids:
            opt = pricing[i]
            c = option_cost(opt, usage)
            h = float(opt.get("ops_hours_per_month", 0))
            cash += c
            hours += h
            per_option.append({"id": i, "label": opt.get("label", i), "layer": opt.get("layer", ""),
                               "cash_usd": round(c, 2), "ops_hours": h})
        time_cost_usd = hours * hourly / fx
        total = cash + time_cost_usd
        rows.append({
            "scale_point": sp["name"],
            "cash_usd": round(cash, 2),
            "ops_hours": round(hours, 1),
            "time_cost_usd": round(time_cost_usd, 2),
            "total_usd": round(total, 2),
            "total_krw": round(total * fx),
            "within_cap": cash <= args.cap_usd,
            "options": per_option,
        })

    warnings = []
    for i in ids:
        opt = pricing[i]
        if opt.get("free_tier_commercial") is False and opt.get("fixed_monthly", 0) == 0:
            warnings.append(f"{opt.get('label', i)}: 무료 티어 상업 사용 불가 — 유료 가격으로 다시 계산할 것")
        if opt.get("spend_cap") is False:
            warnings.append(f"{opt.get('label', i)}: 지출 상한 설정 불가 — 알림 필수")
        if not opt.get("source"):
            warnings.append(f"{opt.get('label', i)}: 출처 없음 — 미검증 표시")

    if args.json:
        print(json.dumps({"hourly_rate_krw": hourly, "fx": fx, "stack": ids, "rows": rows,
                          "warnings": warnings}, ensure_ascii=False, indent=2))
        return

    print(f"스택: {', '.join(pricing[i].get('label', i) for i in ids)}")
    print(f"기준: 시급 {hourly:,.0f}원, 환율 {fx:,.0f}원/$, 현금 상한 ${args.cap_usd:.0f}\n")
    print("| 시점 | 현금 (USD) | 운영 시간 | 시간 비용 (USD) | 합계 (USD) | 합계 (KRW) | 상한 |")
    print("|---|---:|---:|---:|---:|---:|:--:|")
    for r in rows:
        flag = "OK" if r["within_cap"] else "초과"
        print(f"| {r['scale_point']} | {r['cash_usd']:.2f} | {r['ops_hours']:.1f}h | "
              f"{r['time_cost_usd']:.2f} | {r['total_usd']:.2f} | {r['total_krw']:,} | {flag} |")

    print("\n레이어별 현금 (USD):")
    header = "| 옵션 | " + " | ".join(r["scale_point"] for r in rows) + " |"
    print(header)
    print("|---|" + "---:|" * len(rows))
    for idx, i in enumerate(ids):
        cells = " | ".join(f"{r['options'][idx]['cash_usd']:.2f}" for r in rows)
        print(f"| {pricing[i].get('label', i)} | {cells} |")

    if warnings:
        print("\n주의:")
        for w in warnings:
            print(f"- {w}")


if __name__ == "__main__":
    main()
