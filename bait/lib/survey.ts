// 2주 실험이 묻는 것.
//
// 도구를 몇 번 썼는지는 카운터가 센다. 그걸로는 **살 만한 물건인지**를 알 수 없다.
// 그 답은 쓴 사람한테 직접 물어야 하는데, 전화를 걸 수도 없고 걸어서도 안 된다.
// 그래서 확인서를 다 만든 직후 — 이 도구가 쓸모 있다는 걸 방금 확인한 그 순간에 —
// 객관식 세 개를 묻는다.
//
// 규칙 셋을 지킨다.
//
//   1. **PDF를 먼저 준다.** 답을 안 해도 이미 받은 뒤다. 설문이 도구를 인질로 잡지 않는다
//   2. **주관식도 연락처도 받지 않는다.** 보기 중 하나만 서버로 간다.
//      "개인정보를 서버로 보내지 않는다"는 약속을 설문 때문에 깨지 않는다
//   3. **가격을 직접 묻지 않는다.** "얼마면 쓰시겠어요"는 쓸모없는 답을 준다.
//      대신 **지금 얼마를 잃고 있는지**를 묻는다. 가격은 그 숫자에서 나온다

export interface SurveyOption {
  value: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  q: string;
  hint?: string;
  options: SurveyOption[];
}

export type SurveySet = "maker" | "signer";

/** 확인서를 만든 쪽(차주·운송사)에게 묻는다. */
const MAKER: SurveyQuestion[] = [
  {
    id: "role",
    q: "어떤 일을 하세요?",
    options: [
      { value: "driver", label: "화물차주 (개인)" },
      { value: "carrier", label: "운송사 · 주선사" },
      { value: "shipper", label: "화주 · 물류센터" },
      { value: "other", label: "그 외" },
    ],
  },
  {
    id: "loss",
    q: "대기료·부대비용, 작년에 못 받은 돈이 대략 얼마쯤 되세요?",
    hint: "정확하지 않아도 됩니다. 감으로 고르세요",
    options: [
      { value: "none", label: "거의 없다" },
      { value: "m30", label: "한 달에 30만원쯤" },
      { value: "m100", label: "한 달에 100만원쯤" },
      { value: "m300", label: "한 달에 300만원 이상" },
      { value: "never", label: "아예 청구를 안 한다" },
      { value: "unknown", label: "모르겠다" },
    ],
  },
  {
    id: "how",
    q: "지금은 확인서를 어떻게 받으세요?",
    options: [
      { value: "paper", label: "종이에 받는다" },
      { value: "photo", label: "카톡 사진으로 남긴다" },
      { value: "none", label: "못 받고 넘어간다" },
      { value: "system", label: "회사 시스템이 있다" },
      { value: "other", label: "그 외" },
    ],
  },
];

/** 링크를 받아 서명한 쪽(화주 담당자)에게 묻는다. 이쪽 답이 제일 귀하다. */
const SIGNER: SurveyQuestion[] = [
  {
    id: "role",
    q: "어떤 일을 하세요?",
    options: [
      { value: "shipper", label: "화주 · 물류센터 · 현장" },
      { value: "carrier", label: "운송사 · 주선사" },
      { value: "driver", label: "화물차주" },
      { value: "other", label: "그 외" },
    ],
  },
  {
    id: "ask",
    q: "확인서 서명 요청을 받으면 보통 어떻게 하세요?",
    options: [
      { value: "sign", label: "바로 해준다" },
      { value: "check", label: "회사에 확인하고 해준다" },
      { value: "avoid", label: "잘 안 해준다" },
      { value: "first", label: "이런 요청은 처음 받아본다" },
    ],
  },
  {
    id: "howasked",
    q: "평소에는 어떤 방식으로 요청받으세요?",
    options: [
      { value: "paper", label: "종이를 들고 온다" },
      { value: "photo", label: "카톡으로 사진을 보낸다" },
      { value: "system", label: "회사 시스템으로 온다" },
      { value: "none", label: "요청받은 적 없다" },
    ],
  },
];

export const SURVEYS: Record<SurveySet, SurveyQuestion[]> = { maker: MAKER, signer: SIGNER };

/** 서버가 받아들일 값 전체. 여기 없는 값은 기록하지 않는다. */
export function allowedAnswers(set: SurveySet): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const q of SURVEYS[set]) out[q.id] = new Set(q.options.map((o) => o.value));
  return out;
}

const DONE_KEY = "bait.survey.v1";

/** 한 번 답한 묶음은 다시 묻지 않는다. 같은 사람에게 두 번 묻는 건 무례하고 집계도 망친다. */
export function answeredSets(): string[] {
  try {
    const raw = window.localStorage.getItem(DONE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function markAnswered(set: SurveySet): void {
  try {
    const next = Array.from(new Set([...answeredSets(), set]));
    window.localStorage.setItem(DONE_KEY, JSON.stringify(next));
  } catch {
    /* 저장을 못 해도 도구는 돌아간다. 최악이라야 한 번 더 묻는 것이다 */
  }
}

export function shouldAsk(set: SurveySet): boolean {
  return !answeredSets().includes(set);
}

export function sendSurvey(set: SurveySet, answers: Record<string, string>): void {
  const body = JSON.stringify({ set, answers });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/survey", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* 아래로 */
  }
  void fetch("/api/survey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* 설문이 죽어도 사용자는 몰라야 한다 */
  });
}
