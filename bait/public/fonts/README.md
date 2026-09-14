# 폰트

`NanumGothic-Regular.ttf` — Google Fonts 원본 그대로. 손대지 않았다.

- 라이선스: SIL Open Font License 1.1 (`LICENSE-NanumGothic-OFL.txt`)
- 크기: 2.05MB (전송 시 brotli 약 430KB). PDF를 만들 때만 내려받는다
- 수록 글자: 11,856자. 한글 음절 11,172자 **전부** + 라틴 + 문장부호
- **한자는 없다.** 원문자(①), 로마숫자(Ⅳ)도 없다

폰트에 없는 글자는 PDF에 조용히 빈칸으로 찍힌다. 서명까지 받은 문서에서 글자가
사라지는 것이 가장 나쁘므로, `lib/font-coverage.ts`가 이 폰트의 cmap을 그대로
옮겨 담아 만들기 전에 막는다.

폰트를 바꾸면 커버리지 표도 다시 만들어야 한다.

```
python3 tools/gen-font-coverage.py public/fonts/NanumGothic-Regular.ttf
```

## 왜 Noto Sans KR이 아닌가

한자 8,138자를 포함해 수록 글자가 두 배지만, 파일이 6.2MB(brotli 2.5MB)다.
이 도구는 현장에서 폰으로 열어보는 미끼다. 한자가 필요한 확인서는 드물고,
드물게 필요한 경우는 위의 커버리지 검사가 잡아준다. 실험이 통과하면 본체에서
다시 고르면 된다.
