/**
 * Localisation for the Japanese yaku names produced by the scoring library.
 * Unknown names fall back to the original Japanese string.
 */

export type Lang = "ko" | "en" | "ja";

interface Entry {
  ko: string;
  en: string;
}

const TABLE: Record<string, Entry> = {
  門前清自摸和: { ko: "멘젠쯔모", en: "Menzen Tsumo" },
  立直: { ko: "리치", en: "Riichi" },
  両立直: { ko: "더블리치", en: "Double Riichi" },
  一発: { ko: "일발", en: "Ippatsu" },
  槍槓: { ko: "창깡", en: "Chankan" },
  嶺上開花: { ko: "영상개화", en: "Rinshan Kaihou" },
  海底摸月: { ko: "해저로월", en: "Haitei Raoyue" },
  河底撈魚: { ko: "하저로어", en: "Houtei Raoyui" },
  平和: { ko: "핑후", en: "Pinfu" },
  断幺九: { ko: "탕야오", en: "Tanyao" },
  一盃口: { ko: "이페코", en: "Iipeikou" },
  七対子: { ko: "치또이쯔", en: "Chiitoitsu" },
  混全帯幺九: { ko: "찬타", en: "Chanta" },
  一気通貫: { ko: "일기통관", en: "Ittsuu" },
  三色同順: { ko: "삼색동순", en: "Sanshoku Doujun" },
  三色同刻: { ko: "삼색동각", en: "Sanshoku Doukou" },
  三槓子: { ko: "산깡쯔", en: "Sankantsu" },
  対々和: { ko: "또이또이", en: "Toitoi" },
  三暗刻: { ko: "산안커", en: "Sanankou" },
  小三元: { ko: "소삼원", en: "Shousangen" },
  混老頭: { ko: "혼로또", en: "Honroutou" },
  二盃口: { ko: "량페코", en: "Ryanpeikou" },
  純全帯幺九: { ko: "쥰찬", en: "Junchan" },
  混一色: { ko: "혼이쯔", en: "Honitsu" },
  清一色: { ko: "칭이쯔", en: "Chinitsu" },
  流し満貫: { ko: "나가시 만관", en: "Nagashi Mangan" },
  天和: { ko: "천화", en: "Tenhou" },
  地和: { ko: "지화", en: "Chiihou" },
  人和: { ko: "인화", en: "Renhou" },
  国士無双: { ko: "국사무쌍", en: "Kokushi Musou" },
  国士無双十三面待ち: { ko: "국사무쌍 13면대기", en: "Kokushi Juusan Menmachi" },
  九蓮宝燈: { ko: "구련보등", en: "Chuuren Poutou" },
  純正九蓮宝燈: { ko: "순정 구련보등", en: "Junsei Chuuren Poutou" },
  四暗刻: { ko: "스안커", en: "Suuankou" },
  四暗刻単騎: { ko: "스안커 단기", en: "Suuankou Tanki" },
  大三元: { ko: "대삼원", en: "Daisangen" },
  小四喜: { ko: "소사희", en: "Shousuushii" },
  大四喜: { ko: "대사희", en: "Daisuushii" },
  字一色: { ko: "자일색", en: "Tsuuiisou" },
  緑一色: { ko: "녹일색", en: "Ryuuiisou" },
  清老頭: { ko: "청로두", en: "Chinroutou" },
  四槓子: { ko: "스깡쯔", en: "Suukantsu" },
  ドラ: { ko: "도라", en: "Dora" },
  赤ドラ: { ko: "적도라", en: "Red Dora" },
  裏ドラ: { ko: "뒷도라", en: "Ura Dora" },
  北: { ko: "북 빼기", en: "Nukidora" },
};

const WINDS: Record<string, Entry> = {
  東: { ko: "동", en: "East" },
  南: { ko: "남", en: "South" },
  西: { ko: "서", en: "West" },
  北: { ko: "북", en: "North" },
  白: { ko: "백", en: "Haku" },
  發: { ko: "발", en: "Hatsu" },
  中: { ko: "중", en: "Chun" },
};

const PREFIXES: Record<string, Entry> = {
  自風: { ko: "자풍", en: "Seat Wind" },
  場風: { ko: "장풍", en: "Round Wind" },
  役牌: { ko: "역패", en: "Yakuhai" },
};

export function localizeYaku(name: string, lang: Lang = "ko"): string {
  if (lang === "ja") return name;
  const direct = TABLE[name];
  if (direct) return lang === "ko" ? direct.ko : direct.en;

  const [head, tail] = name.split(/\s+/);
  const prefix = PREFIXES[head];
  if (prefix && tail) {
    const wind = WINDS[tail];
    const left = lang === "ko" ? prefix.ko : prefix.en;
    const right = wind ? (lang === "ko" ? wind.ko : wind.en) : tail;
    return `${left} ${right}`;
  }
  return name;
}

export const LIMIT_NAMES: Record<string, Entry> = {
  満貫: { ko: "만관", en: "Mangan" },
  跳満: { ko: "하네만", en: "Haneman" },
  倍満: { ko: "배만", en: "Baiman" },
  三倍満: { ko: "삼배만", en: "Sanbaiman" },
  役満: { ko: "역만", en: "Yakuman" },
  数え役満: { ko: "세어 역만", en: "Kazoe Yakuman" },
  累計役満: { ko: "누계 역만", en: "Kazoe Yakuman" },
};

export function localizeLimit(name: string, lang: Lang = "ko"): string {
  if (!name) return "";
  if (lang === "ja") return name;
  for (const [key, entry] of Object.entries(LIMIT_NAMES)) {
    if (name.startsWith(key)) {
      const localized = lang === "ko" ? entry.ko : entry.en;
      const suffix = name.slice(key.length);
      return suffix ? `${localized}${suffix}` : localized;
    }
  }
  return name;
}

export const DRAW_REASON_NAMES: Record<string, Entry> = {
  exhaustive: { ko: "황패 유국", en: "Exhaustive Draw" },
  kyuushuKyuuhai: { ko: "구종구패", en: "Nine Terminals" },
  suufonRenda: { ko: "사풍연타", en: "Four Winds" },
  suuchaRiichi: { ko: "사가 리치", en: "Four Riichi" },
  suukaikan: { ko: "사깡 유국", en: "Four Kans" },
  sanchahou: { ko: "삼가화", en: "Triple Ron" },
};

export function localizeDrawReason(reason: string, lang: Lang = "ko"): string {
  const entry = DRAW_REASON_NAMES[reason];
  if (!entry) return reason;
  return lang === "ko" ? entry.ko : entry.en;
}
