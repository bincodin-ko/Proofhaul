// 화면과 PDF가 같은 표기를 쓰게 하는 자리.
//
// pdf.ts 안에 두면 이 함수 하나 쓰려고 pdf-lib 500KB를 같이 받아야 한다.
// 서명 화면은 그 전에 시각을 보여줘야 하므로 따로 뺐다.

/**
 * datetime-local 값("2026-03-04T14:02")을 별지 서식의 표기로 바꾼다.
 * 서식의 칸이 "2026년 __월 __일 __시 __분"이다. 못 읽는 값은 그대로 돌려준다.
 */
export function formatFormDateTime(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return raw.trim();
  const [, y, mo, d, h, mi] = m;
  return `${y}년 ${Number(mo)}월 ${Number(d)}일 ${h}시 ${mi}분`;
}

/** 서식의 작성일 칸은 "2026년 __월 __일"이다. */
export function formatFormDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
