"use client";

import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Highlighter,
  LoaderCircle,
  Minus,
  Plus,
  Underline,
} from "lucide-react";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const STORAGE_KEY = "textbook-reader-state-v1";

type AnnotationType = "highlight" | "underline";

type Annotation = {
  id: string;
  start: number;
  end: number;
  type: AnnotationType;
};

type PendingSelection = {
  start: number;
  end: number;
  x: number;
  y: number;
};

type SavedReaderState = {
  title: string;
  author: string;
  text: string;
  fontSize: number;
  lineHeight: number;
  annotations: Annotation[];
  readingOffset: number;
};

function codePointBoundaries(value: string) {
  const boundaries = [0];
  let index = 0;
  for (const character of value) {
    index += character.length;
    boundaries.push(index);
  }
  return boundaries;
}

function drawVerbatimText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
) {
  let line = "";
  let y = startY;

  const commitLine = () => {
    context.fillText(line, x, y);
    line = "";
    y += lineHeight;
  };

  for (const character of value) {
    if (character === "\n") {
      commitLine();
      continue;
    }

    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      commitLine();
      line = character;
    } else {
      line = candidate;
    }
  }

  if (line) context.fillText(line, x, y);
}

function EbookPage({
  kind,
  title,
  author,
  text = "",
  pageNumber,
  fontSize = 16,
  lineHeight = 1.8,
  children,
  onMouseUp,
  onTouchEnd,
}: {
  kind: "cover" | "body";
  title: string;
  author: string;
  text?: string;
  pageNumber?: number;
  fontSize?: number;
  lineHeight?: number;
  children?: ReactNode;
  onMouseUp?: (event: ReactMouseEvent<HTMLElement>) => void;
  onTouchEnd?: (event: ReactTouchEvent<HTMLElement>) => void;
}) {
  if (kind === "cover") {
    return (
      <article className="ebook-page theme-minimal cover-page">
        <div className="cover-accent" />
        <div className="cover-inner">
          <span className="cover-kicker">TEXTBOOK</span>
          <h1>{title || "제목을 입력하세요"}</h1>
          <div className="cover-rule" />
          <p>{author || "저자명"}</p>
        </div>
        <span className="cover-mark">T</span>
      </article>
    );
  }

  return (
    <article
      className="ebook-page theme-minimal body-page reader-book-page"
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      <header className="book-running-head"><span>{title || "제목 없음"}</span></header>
      <div className="page-copy" style={{ fontSize, lineHeight }}>
        {children ?? text}
      </div>
      <footer className="book-page-number">{pageNumber}</footer>
    </article>
  );
}

export default function Home() {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [readingOffset, setReadingOffset] = useState(0);
  const [bodyPages, setBodyPages] = useState<string[]>([]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [scale, setScale] = useState(0.72);
  const [isExporting, setIsExporting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const measureRef = useRef<HTMLDivElement>(null);
  const readerViewportRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const selectionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const state = JSON.parse(saved) as Partial<SavedReaderState>;
          if (typeof state.title === "string") setTitle(state.title);
          if (typeof state.author === "string") setAuthor(state.author);
          if (typeof state.text === "string") setText(state.text);
          if (typeof state.fontSize === "number") setFontSize(Math.min(22, Math.max(14, state.fontSize)));
          if (typeof state.lineHeight === "number") setLineHeight(Math.min(2.2, Math.max(1.5, state.lineHeight)));
          if (Array.isArray(state.annotations)) setAnnotations(state.annotations);
          if (typeof state.readingOffset === "number") setReadingOffset(Math.max(0, state.readingOffset));
        }
      } catch {
        // Invalid or unavailable local data should never block the reader.
      } finally {
        setIsHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const timeout = window.setTimeout(() => {
      const state: SavedReaderState = {
        title,
        author,
        text,
        fontSize,
        lineHeight,
        annotations,
        readingOffset,
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // The reader remains usable if the browser storage quota is unavailable.
      }
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [annotations, author, fontSize, isHydrated, lineHeight, readingOffset, text, title]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure || !text) {
      setBodyPages([]);
      return;
    }

    let cancelled = false;
    const paginate = async () => {
      await document.fonts.ready;
      if (cancelled) return;

      const boundaries = codePointBoundaries(text);
      const pages: string[] = [];
      let startBoundary = 0;

      while (startBoundary < boundaries.length - 1) {
        let low = startBoundary + 1;
        let high = boundaries.length - 1;
        let best = low;

        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          measure.textContent = text.slice(boundaries[startBoundary], boundaries[middle]);
          if (measure.scrollHeight <= measure.clientHeight + 1) {
            best = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }

        pages.push(text.slice(boundaries[startBoundary], boundaries[best]));
        startBoundary = best;
      }

      if (!cancelled) setBodyPages(pages);
    };

    paginate();
    return () => {
      cancelled = true;
    };
  }, [fontSize, lineHeight, text]);

  useEffect(() => {
    const viewport = readerViewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const { width, height } = viewport.getBoundingClientRect();
      setScale(Math.max(0.36, Math.min((width - 40) / PAGE_WIDTH, (height - 92) / PAGE_HEIGHT, 0.9)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!selectionMenuRef.current?.contains(event.target as Node)) setPendingSelection(null);
    };
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  const pageStarts = useMemo(() => {
    return bodyPages.map((_, index) =>
      bodyPages.slice(0, index).reduce((sum, page) => sum + page.length, 0),
    );
  }, [bodyPages]);

  const totalPages = Math.max(1, bodyPages.length);
  const activePage = useMemo(() => {
    if (!bodyPages.length) return 0;
    let page = 0;
    for (let index = 0; index < pageStarts.length; index += 1) {
      if (pageStarts[index] <= readingOffset) page = index;
      else break;
    }
    return Math.min(page, bodyPages.length - 1);
  }, [bodyPages.length, pageStarts, readingOffset]);

  const pageText = bodyPages[activePage] ?? "";
  const pageStart = pageStarts[activePage] ?? 0;

  const changeSourceText = (value: string) => {
    setText(value);
    setAnnotations([]);
    setReadingOffset(0);
    setPendingSelection(null);
  };

  const goToPage = (page: number) => {
    const target = Math.max(0, Math.min(totalPages - 1, page));
    setReadingOffset(pageStarts[target] ?? 0);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const captureSelection = useCallback((container: HTMLElement) => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;

      const prefix = document.createRange();
      prefix.selectNodeContents(container);
      prefix.setEnd(range.startContainer, range.startOffset);
      const localStart = prefix.toString().length;
      const selectedLength = range.toString().length;
      if (!selectedLength) return;

      const rect = range.getBoundingClientRect();
      setPendingSelection({
        start: pageStart + localStart,
        end: pageStart + localStart + selectedLength,
        x: Math.min(window.innerWidth - 105, Math.max(105, rect.left + rect.width / 2)),
        y: Math.max(68, rect.top - 10),
      });
    }, 0);
  }, [pageStart]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const container = document.querySelector<HTMLElement>(".reader-page-shadow .page-copy");
      if (container) captureSelection(container);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [captureSelection]);

  const applyAnnotation = (type: AnnotationType) => {
    if (!pendingSelection) return;
    const { start, end } = pendingSelection;
    setAnnotations((current) => {
      const next = current.flatMap((annotation) => {
        if (annotation.end <= start || annotation.start >= end) return [annotation];
        const pieces: Annotation[] = [];
        if (annotation.start < start) {
          pieces.push({ ...annotation, id: `${annotation.id}-l`, end: start });
        }
        if (annotation.end > end) {
          pieces.push({ ...annotation, id: `${annotation.id}-r`, start: end });
        }
        return pieces;
      });
      return [...next, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end, type }]
        .sort((a, b) => a.start - b.start);
    });
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const removeAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const renderedPage = useMemo(() => {
    if (!pageText) return null;
    const pageEnd = pageStart + pageText.length;
    const visible = annotations.filter((annotation) => annotation.start < pageEnd && annotation.end > pageStart);
    const boundaries = new Set([pageStart, pageEnd]);
    visible.forEach((annotation) => {
      boundaries.add(Math.max(pageStart, annotation.start));
      boundaries.add(Math.min(pageEnd, annotation.end));
    });
    const sorted = Array.from(boundaries).sort((a, b) => a - b);

    return sorted.slice(0, -1).map((start, index) => {
      const end = sorted[index + 1];
      const value = text.slice(start, end);
      const annotation = visible.find((item) => item.start <= start && item.end >= end);
      if (!annotation) return <span key={`${start}-${end}`}>{value}</span>;
      return (
        <mark
          key={`${annotation.id}-${start}`}
          className={`reader-annotation annotation-${annotation.type}`}
          onClick={(event) => {
            event.stopPropagation();
            removeAnnotation(annotation.id);
          }}
          title="눌러서 표시 제거"
        >
          {value}
        </mark>
      );
    });
  }, [annotations, pageStart, pageText, text]);

  const exportPages = useMemo(
    () => [
      { kind: "cover" as const, text: "" },
      ...bodyPages.map((value) => ({ kind: "body" as const, text: value })),
    ],
    [bodyPages],
  );

  const downloadPdf = async () => {
    if (isExporting || !exportRef.current) return;
    setIsExporting(true);

    try {
      const [{ toCanvas }, { PDFDocument }] = await Promise.all([
        import("html-to-image"),
        import("pdf-lib"),
      ]);
      const pageElements = Array.from(exportRef.current.querySelectorAll<HTMLElement>(".ebook-page"));
      const bodyLayouts = pageElements.map((pageElement) => {
        const pageRect = pageElement.getBoundingClientRect();
        const copyElement = pageElement.querySelector<HTMLElement>(".page-copy");
        if (!copyElement) return null;
        const copyRect = copyElement.getBoundingClientRect();
        return {
          x: copyRect.left - pageRect.left,
          y: copyRect.top - pageRect.top,
          width: copyRect.width,
          height: copyRect.height,
          text: copyElement.textContent ?? "",
        };
      });
      const pdf = await PDFDocument.create();

      for (let index = 0; index < pageElements.length; index += 1) {
        let canvas: HTMLCanvasElement;

        if (index === 0) {
          canvas = await toCanvas(pageElements[index], {
            pixelRatio: 2,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            backgroundColor: "#ffffff",
            cacheBust: true,
          });
        } else {
          const layout = bodyLayouts[index];
          if (!layout) throw new Error("본문 페이지를 찾을 수 없습니다.");
          canvas = document.createElement("canvas");
          canvas.width = PAGE_WIDTH * 2;
          canvas.height = PAGE_HEIGHT * 2;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("PDF 캔버스를 만들 수 없습니다.");

          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.save();
          context.scale(2, 2);
          context.beginPath();
          context.rect(layout.x, layout.y, layout.width, layout.height);
          context.clip();
          context.fillStyle = "#242422";
          context.font = `${fontSize}px Arial, "Apple SD Gothic Neo", sans-serif`;
          context.textAlign = "left";
          context.textBaseline = "top";
          drawVerbatimText(context, layout.text, layout.x, layout.y, layout.width, fontSize * lineHeight);
          context.restore();

          context.save();
          context.scale(2, 2);
          const runningTitle = (title || "제목 없음").replace(/\s+/g, " ");
          context.fillStyle = "#aaa7a0";
          context.font = '9px Arial, "Apple SD Gothic Neo", sans-serif';
          context.textAlign = "left";
          context.textBaseline = "top";
          context.fillText(runningTitle, 68, 37, PAGE_WIDTH - 136);
          context.strokeStyle = "#eceae5";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(68, 58.5);
          context.lineTo(PAGE_WIDTH - 68, 58.5);
          context.stroke();
          context.textAlign = "center";
          context.fillText(String(index), PAGE_WIDTH / 2, 803);
          context.restore();
        }

        const image = await pdf.embedPng(canvas.toDataURL("image/png"));
        const pdfPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        pdfPage.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
      }

      const safeTitle = (title || "textbook").replace(/[\\/:*?\"<>|]/g, "-");
      const pdfBytes = await pdf.save({ useObjectStreams: true });
      const pdfBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
      const downloadUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${safeTitle}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="reader-app">
      <header className="reader-header">
        <a className="brand" href="#" aria-label="Textbook 홈">
          <span className="brand-icon"><FileText size={18} strokeWidth={2.2} /></span>
          <span>TEXTBOOK</span>
        </a>
        <div className="reader-header-actions">
          <span className="save-state"><i /> 자동 저장됨</span>
          <button className="secondary-download" onClick={downloadPdf} disabled={isExporting}>
            {isExporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
            {isExporting ? "PDF 만드는 중" : "PDF"}
          </button>
        </div>
      </header>

      <div className="reader-workspace">
        <aside className="source-panel" aria-label="원문 입력">
          <div className="source-heading">
            <span>원문 입력</span>
            <p>붙여넣은 글은 수정 없이 그대로 사용됩니다.</p>
          </div>
          <div className="reader-field-row">
            <label className="reader-field">
              <span>제목</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="제목" />
            </label>
            <label className="reader-field">
              <span>저자</span>
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="저자" />
            </label>
          </div>
          <label className="reader-field source-text-field">
            <span className="source-label-line"><span>본문</span><small>{text.length.toLocaleString("ko-KR")}자</small></span>
            <textarea
              value={text}
              onChange={(event) => changeSourceText(event.target.value)}
              placeholder="읽고 싶은 긴 텍스트를 붙여넣으세요."
              spellCheck={false}
            />
          </label>
          <div className="source-footnote"><span>원문 보존</span> · 표시와 읽던 위치는 이 브라우저에 저장됩니다.</div>
        </aside>

        <section className="reading-panel" aria-label="전자책 뷰어">
          <div className="reading-toolbar">
            <div className="reading-title">
              <strong>{title || "제목 없음"}</strong>
              <span>{text ? `${Math.round(((activePage + 1) / totalPages) * 100)}% 읽음` : "텍스트를 입력해 주세요"}</span>
            </div>
            <div className="reading-controls">
              <div className="control-cluster" aria-label="글자 크기">
                <button onClick={() => setFontSize((value) => Math.max(14, value - 1))} disabled={fontSize === 14} aria-label="글자 작게"><Minus size={14} /></button>
                <span><b>Aa</b> {fontSize}</span>
                <button onClick={() => setFontSize((value) => Math.min(22, value + 1))} disabled={fontSize === 22} aria-label="글자 크게"><Plus size={14} /></button>
              </div>
              <div className="control-cluster" aria-label="줄간격">
                <button onClick={() => setLineHeight((value) => Math.max(1.5, Number((value - 0.1).toFixed(1))))} disabled={lineHeight === 1.5} aria-label="줄간격 좁게"><Minus size={14} /></button>
                <span>줄 {lineHeight.toFixed(1)}</span>
                <button onClick={() => setLineHeight((value) => Math.min(2.2, Number((value + 0.1).toFixed(1))))} disabled={lineHeight === 2.2} aria-label="줄간격 넓게"><Plus size={14} /></button>
              </div>
            </div>
          </div>

          <div className="reader-viewport" ref={readerViewportRef}>
            <div className="reader-page-shadow" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
              <div className="page-scaler reader-page-scaler" style={{ zoom: scale }}>
                <EbookPage
                  kind="body"
                  title={title}
                  author={author}
                  pageNumber={text ? activePage + 1 : undefined}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  onMouseUp={(event) => captureSelection(event.currentTarget.querySelector(".page-copy") as HTMLElement)}
                  onTouchEnd={(event) => captureSelection(event.currentTarget.querySelector(".page-copy") as HTMLElement)}
                >
                  {text ? renderedPage : <span className="empty-reader-copy">왼쪽에 텍스트를 붙여넣으면<br />여기에서 책처럼 읽을 수 있습니다.</span>}
                </EbookPage>
              </div>
            </div>

            <nav className="reader-pagination" aria-label="페이지 이동">
              <button type="button" onClick={() => goToPage(activePage - 1)} disabled={activePage === 0} aria-label="이전 페이지"><ChevronLeft size={20} /></button>
              <span><strong>{activePage + 1}</strong> / {totalPages}</span>
              <button type="button" onClick={() => goToPage(activePage + 1)} disabled={activePage === totalPages - 1} aria-label="다음 페이지"><ChevronRight size={20} /></button>
            </nav>
          </div>
        </section>
      </div>

      {pendingSelection && (
        <div
          className="selection-menu"
          ref={selectionMenuRef}
          style={{ left: pendingSelection.x, top: pendingSelection.y }}
          role="toolbar"
          aria-label="텍스트 표시"
        >
          <button type="button" onClick={() => applyAnnotation("highlight")}><Highlighter size={15} /><span className="yellow-dot" />형광펜</button>
          <span className="menu-divider" />
          <button type="button" onClick={() => applyAnnotation("underline")}><Underline size={15} />밑줄</button>
        </div>
      )}

      <div className="measure-shell theme-minimal" aria-hidden="true">
        <div ref={measureRef} className="page-copy" style={{ fontSize, lineHeight }} />
      </div>

      <div className="export-shell" ref={exportRef} aria-hidden="true">
        {exportPages.map((page, index) => (
          <EbookPage
            key={index}
            kind={page.kind}
            title={title}
            author={author}
            text={page.text}
            pageNumber={index}
            fontSize={fontSize}
            lineHeight={lineHeight}
          />
        ))}
      </div>
    </main>
  );
}
