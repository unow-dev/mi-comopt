import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import {
  accountCandidates,
  keywordCandidates,
  threeClassLabelSummary,
  workflowConfig,
} from "./candidate-data.js";
import { isNewCandidate } from "./new-badge.js";

const VIEW_TITLES = {
  keywords: "フィルターキーワード候補",
  accounts: "アカウントブロック候補",
  labels: "コメントラベル集計",
};

const TABS = [
  ["keywords", "フィルターキーワード"],
  ["accounts", "ブロックアカウント"],
  ["labels", "コメントラベル集計"],
];

const RECOMMENDATION_FILTERS = [
  ["all", "すべて"],
  ["high", "高推奨"],
  ["medium", "中推奨"],
  ["optional", "任意"],
];

const RECOMMENDATION_VALUES = {
  all: null,
  high: "高推奨",
  medium: "中推奨",
  optional: "任意",
};

const LABEL_SUMMARY_ROWS = [
  {
    key: "directNuisance",
    label: "direct_nuisance",
    description: "直接的な迷惑コメント",
    className: "direct",
    badgeClassName: "pink",
  },
  {
    key: "reactive",
    label: "reactive",
    description: "反応・参照コメント",
    className: "reactive",
    badgeClassName: "yellow",
  },
  {
    key: "normal",
    label: "normal",
    description: "通常コメント",
    className: "normal",
    badgeClassName: "blue",
  },
];

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(1) + "%";
}

async function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard APIが使えない環境では、従来のdocument fallbackを使う。
    }
  }

  if (typeof document === "undefined" || !document.body) return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function CopyButton({ value, onCopy, duration, ariaLabel, kind }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function handleClick() {
    const succeeded = await onCopy(value, kind);
    if (!succeeded) return;

    setCopied(true);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      setCopied(false);
      resetTimer.current = null;
    }, duration);
  }

  return (
    <button
      className={"copy-btn" + (copied ? " copied" : "")}
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel || value + " をコピー"}
    >
      {copied ? "コピー済み" : "コピー"}
    </button>
  );
}

function DetailToggle({ open, onToggle, controls, children }) {
  return (
    <button
      className="detail-toggle"
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <span className="chevron" aria-hidden="true">›</span>
      <span>{children}</span>
    </button>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function KeywordCard({ item, hidden, onCopy, now }) {
  const [open, setOpen] = useState(false);
  const detailId = "keyword-detail-" + item.candidateId;
  const variants = (item.variants ?? []).filter(
    (variant) => variant !== item.keyword,
  );
  const recommendationClass =
    item.recommendation === "高推奨"
      ? "high"
      : item.recommendation === "中推奨"
        ? "medium"
        : "optional";
  const isNew = isNewCandidate(
    item.introducedAt,
    now,
    workflowConfig.newKeywordDisplayDays,
  );

  return (
    <article className="candidate-card" hidden={hidden}>
      <div className="candidate-head">
        <h2 className="keyword">{item.keyword}</h2>
        <CopyButton
          value={item.keyword}
          onCopy={onCopy}
          duration={1300}
          kind="keyword"
          ariaLabel={item.keyword + " をコピー"}
        />
      </div>

      <div className="badges" aria-label="分類">
        <span className={"badge " + recommendationClass}>
          {item.recommendation}
        </span>
        <span className="badge category">{item.category}</span>
        {isNew && <span className="badge new">NEW</span>}
      </div>

      <DetailToggle
        open={open}
        onToggle={() => setOpen((current) => !current)}
        controls={detailId}
      >
        詳細
      </DetailToggle>
      <div
        className={"detail-panel" + (open ? " open" : "")}
        id={detailId}
        hidden={!open}
      >
        <DetailRow
          label="direct（命中）"
          value={item.directNuisanceHits + "件"}
        />
        <DetailRow
          label="reactive（参考）"
          value={item.reactiveHits + "件"}
        />
        <DetailRow
          label="normal（誤爆）"
          value={item.normalHits + "件"}
        />
        <DetailRow
          label="精度（reactive除外）"
          value={formatPercent(item.precisionExcludingReactive)}
        />
        {variants.length > 0 && (
          <DetailRow label="表記揺れ" value={variants.join(" / ")} />
        )}
        {item.matchType && (
          <DetailRow label="マッチ方式" value={item.matchType} />
        )}
      </div>
    </article>
  );
}

function AccountCard({ item, onCopy }) {
  const [open, setOpen] = useState(false);
  const detailId = "account-detail-" + item.handle;
  const evidence = item.evidence ?? [];

  return (
    <article className="account-card">
      <div className="account-head">
        <div>
          <h2 className="account-name">{item.handle}</h2>
          <p className="account-meta">
            direct_nuisance{" "}
            <span className="count">{item.directNuisanceCount}件</span>
          </p>
        </div>
        <CopyButton
          value={item.handle}
          onCopy={onCopy}
          duration={1400}
          kind="account"
          ariaLabel={item.handle + " をコピー"}
        />
      </div>

      <DetailToggle
        open={open}
        onToggle={() => setOpen((current) => !current)}
        controls={detailId}
      >
        根拠を確認
      </DetailToggle>
      <div
        className={"detail-panel" + (open ? " open" : "")}
        id={detailId}
        hidden={!open}
      >
        <DetailRow label="判定ラベル" value="direct_nuisance" />
        <DetailRow
          label="該当コメント数"
          value={item.directNuisanceCount + "件"}
        />
        <DetailRow label="候補条件" value="2件以上" />

        <div className="account-evidence-heading">
          <strong>根拠例 {evidence.length}件</strong>
        </div>
        <ol className="account-evidence-list">
          {evidence.map((example, index) => (
            <li
              key={example.postedDate + "-" + example.postedAt + "-" + index}
            >
              <div className="account-evidence-date">
                <time dateTime={example.postedDate}>{example.postedDate}</time>
                <span>{example.postedAt}</span>
              </div>
              <p>{example.comment}</p>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function ViewHero({ eyebrow, title, description }) {
  return (
    <>
      <header className="hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-title">{title}</h1>
      </header>
      <div className="intro">
        <p>{description}</p>
      </div>
    </>
  );
}

function KeywordFilters({
  recommendation,
  onRecommendationChange,
  newOnly,
  onNewOnlyChange,
}) {
  return (
    <div className="filter-area">
      <div className="filter-pills" role="group" aria-label="推奨度で絞り込み">
        {RECOMMENDATION_FILTERS.map(([value, label]) => (
          <button
            className={
              "pill" +
              (value === "all" ? "" : " pill--" + value) +
              (recommendation === value ? " active" : "")
            }
            key={value}
            type="button"
            data-filter={value}
            aria-pressed={recommendation === value}
            onClick={() => onRecommendationChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="new-only">
        <input
          id="newOnly"
          type="checkbox"
          checked={newOnly}
          onChange={(event) => onNewOnlyChange(event.target.checked)}
        />
        <span>NEWのみ</span>
      </label>
    </div>
  );
}

function KeywordResults({ visibleCandidateIds, onCopy, now }) {
  return (
    <>
      <div className="candidate-list" id="candidateList">
        {keywordCandidates.map((item) => (
          <KeywordCard
            key={item.candidateId}
            item={item}
            hidden={!visibleCandidateIds.has(item.candidateId)}
            onCopy={onCopy}
            now={now}
          />
        ))}
      </div>
      <div
        className="empty"
        id="emptyState"
        hidden={visibleCandidateIds.size > 0}
      >
        条件に一致する候補はありません。
      </div>
    </>
  );
}

function AccountResults({ onCopy }) {
  if (accountCandidates.length === 0) {
    return <div className="empty">該当するアカウント候補はありません。</div>;
  }

  return (
    <div className="account-list">
      {accountCandidates.map((item) => (
        <AccountCard key={item.handle} item={item} onCopy={onCopy} />
      ))}
    </div>
  );
}

function LabelSummaryCard({ summary }) {
  const total = summary.total;

  return (
    <section className="summary-panel" aria-labelledby="summary-heading">
      <div className="summary-head">
        <p className="summary-label" id="summary-heading">集計対象</p>
        <p className="summary-total">
          <span>{total.toLocaleString("ja-JP")}</span>件のコメント
        </p>

        <div className="snapshot-block">
          <p className="snapshot-title">スナップショット</p>
          <p className="snapshot-value">{summary.snapshotRef}</p>
        </div>
      </div>

      <div className="label-list">
        {LABEL_SUMMARY_ROWS.map((row) => {
          const count = summary.counts[row.key];
          const percentage = total > 0 ? (count / total) * 100 : 0;
          const shown = percentage.toFixed(1);

          return (
            <article className={"label-card " + row.className} key={row.key}>
              <div className="label-head">
                <div className="label-copy">
                  <span className={"badge " + row.badgeClassName}>
                    {row.label}
                  </span>
                  <p className="label-description">{row.description}</p>
                  <p className="label-stat">
                    <span className="label-count">
                      {count.toLocaleString("ja-JP")}件
                    </span>
                    <span className="label-percent">{shown}%</span>
                  </p>
                </div>
              </div>
              <div
                className="progress-line"
                role="progressbar"
                aria-label={row.label}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={shown}
              >
                <i style={{ "--value": shown + "%" }} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Toast({ state }) {
  const className = [
    "toast",
    state ? "show" : "",
    state?.type === "failure" ? "toast--failure" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} role="status" aria-live="polite">
      {state?.message}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("keywords");
  const [recommendation, setRecommendation] = useState("all");
  const [newOnly, setNewOnly] = useState(false);
  const [now] = useState(() => new Date());
  const [toastState, setToastState] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    document.title = VIEW_TITLES[view];
  }, [view]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const visibleCandidateIds = useMemo(() => {
    const expectedRecommendation = RECOMMENDATION_VALUES[recommendation];
    return new Set(
      keywordCandidates
        .filter((item) => {
          const matchesRecommendation =
            expectedRecommendation === null ||
            item.recommendation === expectedRecommendation;
          const matchesNew =
            !newOnly ||
            isNewCandidate(
              item.introducedAt,
              now,
              workflowConfig.newKeywordDisplayDays,
            );
          return matchesRecommendation && matchesNew;
        })
        .map((item) => item.candidateId),
    );
  }, [newOnly, now, recommendation]);

  function showToast(message, type = "success") {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = window.setTimeout(() => {
      setToastState(null);
      toastTimer.current = null;
    }, 1600);
  }

  async function handleCopy(value, kind) {
    const copied = await copyToClipboard(value);
    if (copied) {
      showToast(
        kind === "account"
          ? value + " をコピーしました"
          : "「" + value + "」をコピーしました",
      );
    } else {
      showToast(
        kind === "account"
          ? value + " をコピーできませんでした"
          : "「" + value + "」をコピーできませんでした",
        "failure",
      );
    }
    return copied;
  }

  return (
    <>
      <main className="app-shell">
        <TabsPrimitive.Root
          className="app-tabs"
          value={view}
          onValueChange={setView}
        >
          <TabsPrimitive.List className="top-tabs" aria-label="管理メニュー">
            {TABS.map(([value, label]) => (
              <TabsPrimitive.Trigger
                className={"top-tab" + (view === value ? " active" : "")}
                key={value}
                type="button"
                value={value}
                aria-current={view === value ? "page" : undefined}
              >
                {label}
              </TabsPrimitive.Trigger>
            ))}
          </TabsPrimitive.List>

          <TabsPrimitive.Content className="view-panel" value="keywords">
            <section className="page-card" aria-labelledby="page-title">
              <ViewHero
                eyebrow="FILTER KEYWORD CANDIDATES"
                title="フィルターキーワード候補"
                description="フィルターに追加するキーワード候補です。迷惑コメントへの該当数と誤判定の少なさで評価しています。詳細から判定結果を確認できます。"
              />
              <div className="content">
                <KeywordFilters
                  recommendation={recommendation}
                  onRecommendationChange={setRecommendation}
                  newOnly={newOnly}
                  onNewOnlyChange={setNewOnly}
                />
                <section className="results" aria-label="フィルターキーワード候補一覧">
                  <KeywordResults
                    visibleCandidateIds={visibleCandidateIds}
                    onCopy={handleCopy}
                    now={now}
                  />
                </section>
              </div>
            </section>
          </TabsPrimitive.Content>

          <TabsPrimitive.Content className="view-panel" value="accounts">
            <section className="page-card" aria-labelledby="page-title">
              <ViewHero
                eyebrow="ACCOUNT BLOCK CANDIDATES"
                title="アカウントブロック候補"
                description="ブロック候補のアカウントです。同じアカウントから迷惑コメントが2件以上ある場合に候補としています。詳細から根拠を確認できます。"
              />
              <div className="content">
                <section className="results" aria-label="アカウントブロック候補一覧">
                  <AccountResults onCopy={handleCopy} />
                </section>
              </div>
            </section>
          </TabsPrimitive.Content>

          <TabsPrimitive.Content className="view-panel" value="labels">
            <section className="page-card" aria-labelledby="page-title">
              <ViewHero
                eyebrow="THREE-CLASS LABEL SUMMARY"
                title="コメントラベル集計"
                description="Comment DBに登録された3分類ラベルの内訳です。集計元のスナップショットを明示しています。"
              />
              <div className="content">
                <LabelSummaryCard summary={threeClassLabelSummary} />
                <div className="data-note">
                  <b>集計データ</b><br />
                  <code>src/data/threeClassLabelSummary.json</code> を参照する画面として構成しています。表示値はスナップショット単位で固定し、3分類の合計と集計対象件数が一致する前提です。
                </div>
              </div>
            </section>
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      </main>
      <Toast state={toastState} />
    </>
  );
}
