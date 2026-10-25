import privacy from '../../docs/product/privacy-policy.md?raw';
import terms from '../../docs/product/terms-and-conditions.md?raw';
// Markdown is rendered as React text nodes. Imported HTML is never executed.
export function Policy({ kind }: { kind: 'privacy' | 'terms' }) {
  const content = kind === 'privacy' ? privacy : terms;
  return (
    <article className="policy">
      <a className="text-link" href="#/settings">
        Back to Settings
      </a>
      {content.split('\n').map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
        if (line.startsWith('- '))
          return (
            <p className="policy-bullet" key={i}>
              {line.slice(2)}
            </p>
          );
        if (!line.trim()) return null;
        return <p key={i}>{line.replace(/\*\*/g, '').replace(/`/g, '')}</p>;
      })}
      <a
        href="https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues"
        target="_blank"
        rel="noopener noreferrer"
      >
        Report an issue on GitHub
      </a>
    </article>
  );
}
