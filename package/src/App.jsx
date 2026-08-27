import { useMemo, useRef, useState } from "react";
import candidates from "./data/filterKeywordCandidates.json";
import accountCandidates from "./data/accountBlockCandidates.json";
import workflowConfig from "./data/candidateWorkflowConfig.json";
import { isNewCandidate } from "./lib/new-badge.js";

function formatPercent(value) {
  if (typeof value !== "number") return "—";
  return `${(value * 100).toFixed(1)}%`;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard APIが使えない環境では、従来のdocument fallbackを使う。
    }
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

function KeywordCard({ item, onCopy, now }) {
  const [open, setOpen] = useState(false);
  const variants = (item.variants ?? []).filter(
    (variant) => variant !== item.keyword
  );
  const isNew = isNewCandidate(
    item.introduced_at,
    now,
    workflowConfig.new_keyword_display_days,
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
              {isNew && <span className="new-badge">NEW</span>}
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

function AccountCard({ item, onCopy }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="account-card">
      <div className="account-card__main">
        <div className="account-card__content">
          <strong className="account-handle">{item.handle}</strong>
          <span className="account-count">
            direct_nuisance {item.direct_nuisance_count}件
          </span>
        </div>

        <div className="account-card__actions">
          <button
            className="copy-button"
            type="button"
            onClick={() => onCopy(item.handle)}
            aria-label={`${item.handle} をコピー`}
          >
            コピー
          </button>

          <button
            className={open ? "detail-toggle detail-toggle--open" : "detail-toggle"}
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
          >
            根拠を確認
            <span className="detail-toggle__icon" aria-hidden="true">⌄</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="account-card__details">
          <div className="account-evidence-heading">
            <strong>根拠例 {item.evidence_sample.length}件</strong>
            <span>計{item.direct_nuisance_count}件</span>
          </div>

          <ol className="account-evidence-list">
            {item.evidence_sample.map((evidence, index) => (
              <li key={`${evidence.postedDate}-${evidence.postedAt}-${index}`}>
                <div className="account-evidence-date">
                  <time dateTime={evidence.postedDate}>{evidence.postedDate}</time>
                  <span>{evidence.postedAt}</span>
                </div>
                <p>{evidence.comment}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [view, setView] = useState("keywords");
  const [recommendation, setRecommendation] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const [now] = useState(() => new Date());

  const filteredCandidates = useMemo(
    () =>
      candidates.filter(
        (item) =>
          (!recommendation || item.recommendation === recommendation) &&
          (!newOnly ||
            isNewCandidate(
              item.introduced_at,
              now,
              workflowConfig.new_keyword_display_days,
            )),
      ),
    [newOnly, now, recommendation],
  );

  function showToast(message) {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1400);
  }

  async function handleCopy(value) {
    await copyToClipboard(value);
    showToast(`「${value}」をコピーしました`);
  }

  return (
    <main className="page-shell">
      <section className="view-switcher" aria-label="表示切替">
        <button
          className={view === "keywords" ? "view-switcher__button view-switcher__button--active" : "view-switcher__button"}
          type="button"
          aria-pressed={view === "keywords"}
          onClick={() => setView("keywords")}
        >
          フィルターキーワード
        </button>
        <button
          className={view === "accounts" ? "view-switcher__button view-switcher__button--active" : "view-switcher__button"}
          type="button"
          aria-pressed={view === "accounts"}
          onClick={() => setView("accounts")}
        >
          ブロックアカウント
        </button>
      </section>

      <section className="hero">
        <div>
          {view === "keywords" ? (
            <>
              <p className="eyebrow">FILTER KEYWORD CANDIDATES</p>
              <h1>フィルターキーワード候補</h1>
              <p className="description">フィルターに追加するキーワード候補です。迷惑コメントへの該当数と誤判定の少なさで評価しています。詳細から判定結果を確認できます。</p>
            </>
          ) : (
            <>
              <p className="eyebrow">ACCOUNT BLOCK CANDIDATES</p>
              <h1>アカウントブロック候補</h1>
              <p className="description">ブロック候補のアカウントです。同じアカウントから迷惑コメントが2件以上ある場合に候補としています。詳細から根拠を確認できます。</p>
            </>
          )}
        </div>
      </section>

      {view === "keywords" && (
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
          <button
            type="button"
            className={
              newOnly
                ? "recommendation-tab recommendation-tab--active"
                : "recommendation-tab"
            }
            aria-pressed={newOnly}
            onClick={() => setNewOnly((current) => !current)}
          >
            NEW
          </button>
        </section>
      )}

      <section className="results">
        <div className="card-frame">
          {view === "accounts" ? (
            accountCandidates.length > 0 ? (
              <div className="account-list">
                {accountCandidates.map((item) => (
                  <AccountCard key={item.handle} item={item} onCopy={handleCopy} />
                ))}
              </div>
            ) : (
              <div className="empty-state account-empty-state">
                <strong>該当するアカウント候補はありません</strong>
                <p>現在のデータでは、候補条件を満たすアカウントはありません。</p>
              </div>
            )
          ) : filteredCandidates.length > 0 ? (
            <div className="keyword-list">
              {filteredCandidates.map((item) => (
                <KeywordCard
                  key={item.candidate_id}
                  item={item}
                  onCopy={handleCopy}
                  now={now}
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

      {view === "keywords" ? (
        <footer>
          <p>
            JSONデータは <code>src/data/filterKeywordCandidates.json</code>{" "}
            に分離されています。候補の識別には永続的な <code>candidate_id</code> を使用します。
          </p>
        </footer>
      ) : (
        <footer>
          <p>
            アカウント候補は根拠を確認したうえで、利用者が手動で判断してください。
          </p>
        </footer>
      )}

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
