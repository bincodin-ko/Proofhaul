"use client";

import { useState } from "react";
import { SURVEYS, type SurveySet, markAnswered, sendSurvey } from "@/lib/survey";

interface Props {
  set: SurveySet;
  onClose: () => void;
}

/**
 * 한 번에 한 문항만 보여준다.
 *
 * 세 개를 한 화면에 늘어놓으면 길어 보여서 시작을 안 한다. 하나씩 보여주고
 * 누르면 넘어가게 하면 끝까지 간다. 어느 화면에서든 건너뛸 수 있다.
 */
export default function SurveyCard({ set, onClose }: Props) {
  const questions = SURVEYS[set];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const question = questions[step];

  const finish = (all: Record<string, string>) => {
    sendSurvey(set, all);
    markAnswered(set);
    setDone(true);
  };

  const pick = (value: string) => {
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    if (step + 1 < questions.length) {
      setStep(step + 1);
      return;
    }
    finish(next);
  };

  const skip = () => {
    // 하나라도 답했으면 그것만이라도 보낸다. 통째로 버리면 그 사람의 답이 사라진다.
    if (Object.keys(answers).length > 0) sendSurvey(set, answers);
    markAnswered(set);
    onClose();
  };

  if (done) {
    return (
      <div className="survey survey-thanks">
        <div className="sv-title">답해주셔서 고맙습니다</div>
        <p className="sv-body">
          이 도구를 계속 만들지 말지 정하는 데 그대로 씁니다.
        </p>
        <button type="button" className="btn od-touch" onClick={onClose}>닫기</button>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="survey">
      <div className="sv-head">
        <span className="sv-step">{step + 1} / {questions.length}</span>
        <button type="button" className="sv-skip" onClick={skip}>건너뛰기</button>
      </div>
      <div className="sv-title">{question.q}</div>
      {question.hint && <p className="sv-hint">{question.hint}</p>}
      <div className="sv-options">
        {question.options.map((o) => (
          <button key={o.value} type="button" className="btn od-touch" onClick={() => pick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="sv-body">
        고른 항목 하나만 익명으로 보냅니다. 이름·연락처·입력한 내용은 보내지 않습니다.
      </p>
    </div>
  );
}
