const SOURCES = [
  { id: 'EPARK',  label: 'ePark',  available: true },
  { id: 'KILANG', label: 'Kilang', available: true, language: 'Amis' },
  { id: 'ILRDF',  label: 'ILRDF',  available: false },
];

const DEFAULTS = {
  language: 'Amis',
  sources: ['KILANG'],
  showDialect: true,
  boldText: true,
  maxResults: 6,
  theme: 'dark',
  fontSize: 'medium',
  triggerDblclick: true,
  triggerCtrlSelect: true,
  triggerHover: false,
  enabled: true,
  altSpelling: true,
  moeKilangInsights: false,
  aiToolsEnabled: false,
};

const LANG_TO_DIALECTS = {
  'Amis':        '南勢阿美語,秀姑巒阿美語,海岸阿美語,馬蘭阿美語,恆春阿美語',
  'Atayal':      '賽考利克泰雅語,澤敖利泰雅語,汶水泰雅語,萬大泰雅語,四季泰雅語,宜蘭澤敖利泰雅語,賽考利克太魯閣語,斯卡羅泰雅語',
  'Paiwan':      '南排灣語,中排灣語,北排灣語,東排灣語',
  'Bunun':       '卓群布農語,卡群布農語,丹群布農語,巒群布農語,郡群布農語',
  'Puyuma':      '南王卑南語,知本卑南語,西群卑南語,建和卑南語',
  'Rukai':       '霧台魯凱語,茂林魯凱語,多納魯凱語,東魯凱語,萬山魯凱語,大武魯凱語',
  'Tsou':        '鄒語',
  'Saisiyat':    '賽夏語',
  'Tao (Yami)':  '雅美語',
  'Thao':        '邵語',
  'Kavalan':     '噶瑪蘭語',
  'Truku':       '太魯閣語',
  'Sakizaya':    '撒奇萊雅語',
  'Seediq':      '德固達雅賽德克語,都達賽德克語,德鹿谷賽德克語',
  "Hla'alua":    '拉阿魯哇語',
  'Kanakanavu':  '卡那卡那富語',
};
