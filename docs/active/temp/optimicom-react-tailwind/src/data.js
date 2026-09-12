export const TITLES = {
  home: ['ホーム', 'コメント欄最適化プラットフォーム'],
  overview: ['集計・現状・推移', 'コメント欄の健全性と推移を確認'],
  comments: ['コメント一覧', '6分類でコメントを確認'],
  keywords: ['フィルターキーワード候補', '候補をコピーして処理状況を管理'],
  accounts: ['ブロックアカウント候補', '候補アカウントをコピーして管理'],
}

export const COMMENT_KINDS = [
  { id: 'positive', label: '肯定的', count: 8842, tone: 'blue' },
  { id: 'neutral', label: '中庸的', count: 3868, tone: 'green' },
  { id: 'critical', label: '批判的', count: 2764, tone: 'pink' },
  { id: 'counter-critical', label: '対批判', count: 1104, tone: 'yellow' },
  { id: 'nuisance', label: '迷惑', count: 1289, tone: 'purple' },
  { id: 'counter-nuisance', label: '対迷惑', count: 553, tone: 'cyan' },
]

export const COMMENTS = [
  { kind: 'positive', order: 6, user: '@mari_blue', avatar: 'M', text: '今回の動画すごく見やすかった！次回も楽しみにしています。' },
  { kind: 'neutral', order: 5, user: '@tomo_log', avatar: 'T', text: '内容は理解できました。次回の更新内容も確認してみます。' },
  { kind: 'critical', order: 4, user: '@kuro_note', avatar: 'K', text: '説明が長すぎて要点が分かりにくい。冒頭でもっと結論を出してほしい。' },
  { kind: 'counter-critical', order: 3, user: '@riku_reply', avatar: 'R', text: 'その点は動画内で理由も説明されていたと思います。変更の意図は理解できます。' },
  { kind: 'nuisance', order: 2, user: '@x_deal_now', avatar: 'X', text: '今だけ無料！プロフィールのリンクから限定オファーを確認してください！！！' },
  { kind: 'counter-nuisance', order: 1, user: '@ao_guard', avatar: 'A', text: 'このリンクは開かない方がいいです。迷惑投稿として通報しました。' },
]

export const KEYWORD_CANDIDATES = [
  {
    id: 'limited-offer',
    keyword: '限定オファー',
    risk: 'high',
    riskLabel: '高リスク',
    meta: ['出現 128件', '外部誘導系', 'new'],
    isNew: true,
    reason: '外部サイトへの誘導を伴う投稿で反復して検出されています。',
  },
  {
    id: 'winner',
    keyword: '当選しました',
    risk: 'high',
    riskLabel: '高リスク',
    meta: ['出現 83件', '当選詐称系'],
    isNew: false,
    reason: '当選を装った誘導文面として複数の投稿で検出されています。',
  },
  {
    id: 'check-now',
    keyword: '今すぐ確認',
    risk: 'mid',
    riskLabel: '中リスク',
    meta: ['出現 64件', '連投傾向'],
    isNew: false,
    reason: '短時間の連投で繰り返し出現しています。通常コメントにも含まれるため確認を推奨します。',
  },
]

export const ACCOUNT_CANDIDATES = [
  { id: 'x_deal_now', user: '@x_deal_now', avatar: 'X', risk: 'high', riskLabel: '高リスク', nuisanceCount: 139 },
  { id: 'gift_777', user: '@gift_777', avatar: 'G', risk: 'high', riskLabel: '高リスク', nuisanceCount: 85 },
  { id: 'promo_pick', user: '@promo_pick', avatar: 'P', risk: 'mid', riskLabel: '中リスク', nuisanceCount: 35 },
]

export const ACCOUNT_HISTORY = {
  x_deal_now: [
    { text: '今だけ無料！プロフィールのリンクから限定オファーを確認してください！！！', date: '2026/09/12 18:42' },
    { text: '先着順です。今すぐこちらのリンクを開いて登録してください。', date: '2026/09/12 18:18' },
    { text: '限定プレゼント配布中。詳細は外部サイトで確認できます。', date: '2026/09/12 17:51' },
    { text: 'キャンペーン終了間近！プロフィール欄からアクセスしてください。', date: '2026/09/12 17:09' },
  ],
  gift_777: [
    { text: '当選しました。こちらから受け取り → 外部リンク', date: '2026/09/12 18:21' },
    { text: 'おめでとうございます！特典受け取りのためリンクを確認してください。', date: '2026/09/12 17:46' },
    { text: '限定ギフトの受取期限は本日までです。今すぐアクセス。', date: '2026/09/12 16:58' },
  ],
  promo_pick: [
    { text: 'おすすめキャンペーン実施中。詳しくはプロフィールのURLへ。', date: '2026/09/12 17:35' },
    { text: '今だけ特別価格。詳細ページから申し込みできます。', date: '2026/09/12 15:52' },
  ],
}
