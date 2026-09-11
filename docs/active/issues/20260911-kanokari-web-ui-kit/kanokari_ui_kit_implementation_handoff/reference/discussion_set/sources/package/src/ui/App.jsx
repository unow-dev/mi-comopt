import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  accountCandidates,
  keywordCandidates,
  threeClassLabelSummary,
  workflowConfig,
} from "./candidate-data.js";
import { isNewCandidate } from "./new-badge.js";

function formatPercent(value) {
  if (typeof value !== "number") return "—";
  return `${(value * 100).toFixed(1)}%`;
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

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

const RECOMMENDATION_VARIANTS = {
  高推奨: "mint",
  中推奨: "lemon",
  任意: "lilac",
};

function RecommendationBadge({ value }) {
  return (
    <Badge variant={RECOMMENDATION_VARIANTS[value] ?? "lilac"} size="sm">
      {value}
    </Badge>
  );
}

const LABEL_SUMMARY_ROWS = [
  {
    key: "directNuisance",
    label: "direct_nuisance",
    description: "直接的な迷惑コメント",
    variant: "pink",
    progressClassName: "bg-y2k-pink",
  },
  {
    key: "reactive",
    label: "reactive",
    description: "反応・参照コメント",
    variant: "lemon",
    progressClassName: "bg-y2k-lemon",
  },
  {
    key: "normal",
    label: "normal",
    description: "通常コメント",
    variant: "blue",
    progressClassName: "bg-y2k-blue",
  },
];

function LabelSummaryCard({ summary }) {
  return (
    <Card className="label-summary">
      <CardHeader className="label-summary__header">
        <div>
          <span className="label-summary__eyebrow">集計対象</span>
          <h2 id="label-summary-heading">
            {summary.total.toLocaleString("ja-JP")}件のコメント
          </h2>
        </div>
        <div className="label-summary__source">
          <span>スナップショット</span>
          <code>{summary.snapshotRef}</code>
        </div>
      </CardHeader>

      <CardContent className="label-summary__rows">
        {LABEL_SUMMARY_ROWS.map((row) => {
          const count = summary.counts[row.key];
          const ratio = summary.total > 0 ? count / summary.total : 0;

          return (
            <div className="label-summary__row" key={row.key}>
              <div className="label-summary__row-header">
                <div>
                  <Badge variant={row.variant} size="sm">
                    {row.label}
                  </Badge>
                  <span>{row.description}</span>
                </div>
                <div className="label-summary__row-values">
                  <strong>{count.toLocaleString("ja-JP")}件</strong>
                  <span>{formatPercent(ratio)}</span>
                </div>
              </div>
              <Progress
                value={ratio * 100}
                aria-label={`${row.label}の割合`}
                indicatorClassName={row.progressClassName}
                className="label-summary__progress"
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DetailMetrics({ item }) {
  const metrics = [
    ["direct", item.directNuisanceHits, "命中"],
    ["reactive", item.reactiveHits, "参考"],
    ["normal", item.normalHits, "誤爆"],
    ["精度", formatPercent(item.precisionExcludingReactive), "reactive除外"],
  ];

  return (
    <div className="detail-metrics">
      {metrics.map(([label, value, description]) => (
        <div className="detail-metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{description}</small>
        </div>
      ))}
    </div>
  );
}

function KeywordCard({ item, onCopy, now }) {
  const [open, setOpen] = useState(false);
  const variants = (item.variants ?? []).filter(
    (variant) => variant !== item.keyword,
  );
  const isNew = isNewCandidate(
    item.introducedAt,
    now,
    workflowConfig.newKeywordDisplayDays,
  );

  return (
    <Card className="candidate-card keyword-card">
      <CardContent className="candidate-card__main">
        <div className="candidate-card__content">
          <div className="keyword-card__title-row">
            <strong className="keyword">{item.keyword}</strong>
            <div className="keyword-card__badges">
              <RecommendationBadge value={item.recommendation} />
              <Badge variant="blue" size="sm">
                {item.category}
              </Badge>
              {isNew && (
                <Badge variant="pink" size="sm">
                  NEW
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="candidate-card__actions">
          <Button
            variant="outline"
            size="sm"
            className="copy-button"
            type="button"
            onClick={() => onCopy(item.keyword)}
            aria-label={`${item.keyword} をコピー`}
          >
            コピー
          </Button>
        </div>
      </CardContent>

      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="candidate-collapsible"
      >
        <CollapsibleTrigger className="detail-trigger">詳細</CollapsibleTrigger>
        <CollapsibleContent className="detail-content">
          <DetailMetrics item={item} />

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

          {item.matchType && (
            <div className="match-type">
              <span>マッチ方式</span>
              <strong>{item.matchType}</strong>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function AccountCard({ item, onCopy }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="candidate-card account-card">
      <CardContent className="candidate-card__main">
        <div className="candidate-card__content">
          <strong className="account-handle">{item.handle}</strong>
          <span className="account-count">
            direct_nuisance {item.directNuisanceCount}件
          </span>
        </div>

        <div className="candidate-card__actions">
          <Button
            variant="outline"
            size="sm"
            className="copy-button"
            type="button"
            onClick={() => onCopy(item.handle)}
            aria-label={`${item.handle} をコピー`}
          >
            コピー
          </Button>
        </div>
      </CardContent>

      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="candidate-collapsible"
      >
        <CollapsibleTrigger className="detail-trigger">
          根拠を確認
        </CollapsibleTrigger>
        <CollapsibleContent className="detail-content">
          <div className="account-evidence-heading">
            <strong>根拠例 {item.evidence.length}件</strong>
            <span>計{item.directNuisanceCount}件</span>
          </div>

          <ol className="account-evidence-list">
            {item.evidence.map((evidence, index) => (
              <li key={`${evidence.postedDate}-${evidence.postedAt}-${index}`}>
                <div className="account-evidence-date">
                  <time dateTime={evidence.postedDate}>{evidence.postedDate}</time>
                  <span>{evidence.postedAt}</span>
                </div>
                <p>{evidence.comment}</p>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function ViewHero({ eyebrow, title, description }) {
  return (
    <Card className="hero-card">
      <CardHeader className="hero-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </CardHeader>
      <CardContent>
        <CardDescription className="description">{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

const RECOMMENDATION_FILTERS = [
  ["all", "すべて", "blue"],
  ["high", "高推奨", "mint"],
  ["medium", "中推奨", "lemon"],
  ["optional", "任意", "lilac"],
];

const RECOMMENDATION_VALUES = {
  all: null,
  high: "高推奨",
  medium: "中推奨",
  optional: "任意",
};

function KeywordFilters({
  recommendation,
  onRecommendationChange,
  newOnly,
  onNewOnlyChange,
}) {
  return (
    <section className="controls" aria-label="候補の絞り込み">
      <ToggleGroup
        type="single"
        value={recommendation}
        onValueChange={(value) => {
          if (typeof value === "string" && value) onRecommendationChange(value);
        }}
        aria-label="推奨度"
        className="recommendation-group"
      >
        {RECOMMENDATION_FILTERS.map(([value, label, variant]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            variant={variant}
            size="sm"
            className={`recommendation-filter recommendation-filter--${variant}`}
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="new-filter">
        <Checkbox
          id="new-only"
          checked={newOnly}
          onCheckedChange={(checked) => onNewOnlyChange(checked === true)}
        />
        <Label htmlFor="new-only">NEWのみ</Label>
      </div>
    </section>
  );
}

function KeywordResults({ candidates, onCopy, now }) {
  if (candidates.length === 0) {
    return (
      <Empty
        className="empty-state"
        title="該当する候補がありません"
        description="検索語または絞り込み条件を変更してください。"
      />
    );
  }

  return (
    <div className="candidate-list">
      {candidates.map((item) => (
        <KeywordCard key={item.candidateId} item={item} onCopy={onCopy} now={now} />
      ))}
    </div>
  );
}

function AccountResults({ onCopy }) {
  if (accountCandidates.length === 0) {
    return (
      <Empty
        className="empty-state"
        title="該当するアカウント候補はありません"
        description="現在のデータでは、候補条件を満たすアカウントはありません。"
      />
    );
  }

  return (
    <div className="candidate-list">
      {accountCandidates.map((item) => (
        <AccountCard key={item.handle} item={item} onCopy={onCopy} />
      ))}
    </div>
  );
}

function ViewFooter({ view }) {
  if (view === "keywords") {
    return (
      <footer>
        <p>
          JSONデータは <code>src/data/filterKeywordCandidates.json</code> に分離されています。候補の識別には永続的な <code>candidate_id</code> を使用します。
        </p>
      </footer>
    );
  }

  if (view === "accounts") {
    return (
      <footer>
        <p>アカウント候補は根拠を確認したうえで、利用者が手動で判断してください。</p>
      </footer>
    );
  }

  return (
    <footer>
      <p>
        集計データは <code>src/data/threeClassLabelSummary.json</code> をComment DBから出力して更新します。
      </p>
    </footer>
  );
}

export default function App() {
  const [view, setView] = useState("keywords");
  const [recommendation, setRecommendation] = useState("all");
  const [newOnly, setNewOnly] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const previousScrollY = useRef(0);
  const [now] = useState(() => new Date());

  useEffect(() => {
    previousScrollY.current = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;

      if (currentScrollY <= 8) {
        setIsHeaderVisible(true);
      } else if (currentScrollY > previousScrollY.current) {
        setIsHeaderVisible(false);
      } else if (currentScrollY < previousScrollY.current) {
        setIsHeaderVisible(true);
      }

      previousScrollY.current = currentScrollY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const filteredCandidates = useMemo(
    () =>
      keywordCandidates.filter(
        (item) =>
          (RECOMMENDATION_VALUES[recommendation] === null ||
            item.recommendation === RECOMMENDATION_VALUES[recommendation]) &&
          (!newOnly ||
            isNewCandidate(
              item.introducedAt,
              now,
              workflowConfig.newKeywordDisplayDays,
            )),
      ),
    [newOnly, now, recommendation],
  );

  async function handleCopy(value) {
    const copied = await copyToClipboard(value);
    if (copied) {
      toast.success(`「${value}」をコピーしました`);
    } else {
      toast.error(`「${value}」をコピーできませんでした`);
    }
  }

  return (
    <>
      <main className="page-shell">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value)}
          className="app-tabs"
        >
          <TabsList
            aria-label="表示切替"
            className={`view-switcher${isHeaderVisible ? "" : " view-switcher--hidden"}`}
          >
            <TabsTrigger value="keywords">フィルターキーワード</TabsTrigger>
            <TabsTrigger value="accounts">ブロックアカウント</TabsTrigger>
            <TabsTrigger value="labels">コメントラベル集計</TabsTrigger>
          </TabsList>

          <TabsContent value="keywords" className="view-panel">
            <ViewHero
              eyebrow="FILTER KEYWORD CANDIDATES"
              title="フィルターキーワード候補"
              description="フィルターに追加するキーワード候補です。迷惑コメントへの該当数と誤判定の少なさで評価しています。詳細から判定結果を確認できます。"
            />
            <KeywordFilters
              recommendation={recommendation}
              onRecommendationChange={setRecommendation}
              newOnly={newOnly}
              onNewOnlyChange={setNewOnly}
            />
            <section className="results" aria-label="フィルターキーワード候補一覧">
              <KeywordResults candidates={filteredCandidates} onCopy={handleCopy} now={now} />
            </section>
            <ViewFooter view="keywords" />
          </TabsContent>

          <TabsContent value="accounts" className="view-panel">
            <ViewHero
              eyebrow="ACCOUNT BLOCK CANDIDATES"
              title="アカウントブロック候補"
              description="ブロック候補のアカウントです。同じアカウントから迷惑コメントが2件以上ある場合に候補としています。詳細から根拠を確認できます。"
            />
            <section className="results" aria-label="アカウントブロック候補一覧">
              <AccountResults onCopy={handleCopy} />
            </section>
            <ViewFooter view="accounts" />
          </TabsContent>

          <TabsContent value="labels" className="view-panel">
            <ViewHero
              eyebrow="THREE-CLASS LABEL SUMMARY"
              title="コメントラベル集計"
              description="Comment DBに登録された3分類ラベルの内訳です。集計元のスナップショットを明示しています。"
            />
            <section className="results" aria-labelledby="label-summary-heading">
              <LabelSummaryCard summary={threeClassLabelSummary} />
            </section>
            <ViewFooter view="labels" />
          </TabsContent>
        </Tabs>
      </main>
      <Toaster />
    </>
  );
}
