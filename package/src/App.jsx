import { useMemo, useRef, useState } from "react";
import candidates from "./data/filterKeywordCandidates.json";

const RECOMMENDATION_ORDER = {
  "高推奨": 0,
  "中推奨": 1,
  "任意": 2,
};

const SORT_OPTIONS = [
  { value: "recommendation", label: "推奨度順" },
  { value: "direct_desc", label: "direct 命中数が多い順" },
  { value: "normal_asc", label: "normal 誤爆が少ない順" },
  { value: "precision_desc", label: "精度が高い順" },
  { value: "keyword", label: "キーワード順" },
];

function formatPercent(value) {
  if (typeof value !== "number") return "—";
  return `${(value * 100).toFixed(1)}%`;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function RecommendationBadge({ value }) {
  const className =
    value === "高推奨"
      ? "badge badge--high"
      : value === "中推奨"
        ? "badge badge--medium"
        : "badge badge--optional";

  return <span className={className}>{value}</span>;
}

function SummaryCard({ label, value }) {
  return (
    <div className="summary-card">
      <span className="summary-card__label">{label}</span>
      <strong className="summary-card__value">{value}</strong>
    </div>
  );
}

function KeywordCard({ item, onCopy }) {
  const [open, setOpen] = useState(false);
  const variants = (item.variants ?? []).filter(
    (variant) => variant !== item.keyword
  );

  return (
    <article className="keyword-card">
      <div className="keyword-card__main">
        <div className="keyword-card__content">
          <div className="keyword-card__title-row">
            <strong className="keyword">{item.keyword}</strong>

            <div className="keyword-card__badges">
              <RecommendationBadge value={item.recommendation} />
              <span className="category-badge">{item.category}</span>
            </div>
          </div>
        </div>

        <div className="keyword-card__actions">
          <button
            className="copy-button"
            type="button"
            onClick={() => onCopy(item.keyword)}
            aria-label={`${item.keyword} をコピー`}
          >
            コピー
          </button>

          <button
            className={open ? "detail-toggle detail-toggle--open" : "detail-toggle"}
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
          >
            詳細
            <span className="detail-toggle__icon" aria-hidden="true">⌄</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="keyword-card__details">
          <div className="detail-metrics">
            <div className="detail-metric">
              <span>direct</span>
              <strong>{item.direct_nuisance_hits}</strong>
              <small>命中</small>
            </div>

            <div className="detail-metric">
              <span>reactive</span>
              <strong>{item.reactive_hits}</strong>
              <small>参考</small>
            </div>

            <div className="detail-metric">
              <span>normal</span>
              <strong>{item.normal_hits}</strong>
              <small>誤爆</small>
            </div>

            <div className="detail-metric">
              <span>精度</span>
              <strong>{formatPercent(item.precision_excluding_reactive)}</strong>
              <small>reactive除外</small>
            </div>
          </div>

          {variants.length > 0 && (
            <div className="variants variants--details">
              <span>表記揺れ</span>
              <div className="variant-list">
                {variants.map((variant) => (
                  <code key={variant}>{variant}</code>
                ))}
              </div>
            </div>
          )}

          {item.match_type && (
            <div className="match-type">
              <span>マッチ方式</span>
              <strong>{item.match_type}</strong>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [recommendation, setRecommendation] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);



  const filteredCandidates = useMemo(
    () =>
      recommendation
        ? candidates.filter((item) => item.recommendation === recommendation)
        : candidates,
    [recommendation]
  );

  function showToast(message) {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1400);
  }

  async function handleCopy(keyword) {
    await copyToClipboard(keyword);
    showToast(`「${keyword}」をコピーしました`);
  }



  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">FILTER KEYWORD CANDIDATES</p>
          <h1>フィルターキーワード候補リスト</h1>
          <p className="description">
            direct_nuisance の命中を重視し、normal のヒットだけを誤爆として評価。
            reactive は推奨度の減点に使わず、参考値として表示しています。
          </p>
        </div>
      </section>

      <section className="controls controls--simple">
        <div className="recommendation-tabs" role="group" aria-label="推奨度">
          {[
            ["", "すべて"],
            ["高推奨", "高推奨"],
            ["中推奨", "中推奨"],
            ["任意", "任意"],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={
                recommendation === value
                  ? "recommendation-tab recommendation-tab--active"
                  : "recommendation-tab"
              }
              onClick={() => setRecommendation(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="results">

        <div className="card-frame">
          {filteredCandidates.length > 0 ? (
            <div className="keyword-list">
              {filteredCandidates.map((item) => (
                <KeywordCard
                  key={`${item.keyword}-${item.category}`}
                  item={item}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>該当する候補がありません</strong>
              <p>検索語または絞り込み条件を変更してください。</p>
            </div>
          )}
        </div>
      </section>

      <footer>
        <p>
          JSONデータは <code>src/data/filterKeywordCandidates.json</code>{" "}
          に分離されています。
        </p>
      </footer>

      <div
        className={toast ? "toast toast--visible" : "toast"}
        aria-live="polite"
        aria-atomic="true"
      >
        {toast}
      </div>
    </main>
  );
}
