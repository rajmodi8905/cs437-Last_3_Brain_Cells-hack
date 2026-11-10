// S16: EmbeddingGemma is the default search model. A student can add their own model from
// Hugging Face; it is downloaded and tested here first, and nothing switches until they choose it.
import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  GEMMA,
  MAX_CUSTOM_MODEL_BYTES,
  type CustomModelConfig,
  type SearchModel,
} from '../shared/searchModels';
import { downloadSize } from './SetupProgress';

type AddOptions = Pick<CustomModelConfig, 'pooling' | 'queryPrefix' | 'documentPrefix'>;

export function SearchModelPicker({
  current,
  custom,
  sizeOf,
  switching,
  onSwitch,
  adding,
  addError,
  onAdd,
}: {
  current: SearchModel;
  custom?: SearchModel;
  sizeOf: (model: SearchModel) => number;
  switching: boolean;
  onSwitch: (model: SearchModel) => void;
  adding: string;
  addError: string;
  onAdd: (repo: string, options: AddOptions) => void;
}) {
  const options = custom ? [GEMMA, custom] : [GEMMA];
  const [chosen, setChosen] = useState(current.indexVersion);
  // Follow the model in use and a newly added model in the same render, so the new option never
  // shows unselected. A model that was just added is selected, ready to confirm.
  const [seen, setSeen] = useState({ current: current.indexVersion, custom: custom?.indexVersion });
  if (seen.current !== current.indexVersion || seen.custom !== custom?.indexVersion) {
    setSeen({ current: current.indexVersion, custom: custom?.indexVersion });
    setChosen(
      custom && custom.indexVersion !== seen.custom && custom.indexVersion !== current.indexVersion
        ? custom.indexVersion
        : current.indexVersion,
    );
  }
  const target = options.find((model) => model.indexVersion === chosen) ?? GEMMA;
  const [repo, setRepo] = useState('');
  const [pooling, setPooling] = useState<AddOptions['pooling']>('mean');
  const [queryPrefix, setQueryPrefix] = useState('');
  const [documentPrefix, setDocumentPrefix] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (repo.trim()) onAdd(repo.trim(), { pooling, queryPrefix, documentPrefix });
  };
  const busy = switching || !!adding;
  return (
    <div className="search-model">
      <div role="radiogroup" aria-labelledby="search-model-label" className="search-model-options">
        <p id="search-model-label" className="search-model-label">
          Search model
        </p>
        {options.map((model) => {
          const size = sizeOf(model);
          const id = `search-model-${model.custom ? 'custom' : 'default'}`;
          return (
            <div key={model.indexVersion} className="search-model-option">
              <label>
                <input
                  type="radio"
                  name="search-model"
                  value={model.indexVersion}
                  checked={chosen === model.indexVersion}
                  disabled={busy}
                  aria-describedby={id}
                  onChange={() => setChosen(model.indexVersion)}
                />
                <strong>{model.label}</strong>
                {model.experimental && <span className="small muted"> · experimental</span>}
                {model.indexVersion === current.indexVersion && (
                  <span className="small muted"> · in use</span>
                )}
              </label>
              <p id={id} className="field-help">
                {size ? `About ${downloadSize(size)} to set up. ` : ''}
                {model.custom
                  ? `On this device it found ${model.custom.calibration.correct} of ${model.custom.calibration.total} sample questions and wrongly matched ${model.custom.calibration.unrelatedMatched} of ${model.custom.calibration.unrelatedTotal} unrelated ones. `
                  : ''}
                {model.summary}
              </p>
            </div>
          );
        })}
      </div>
      {chosen !== current.indexVersion && (
        <>
          <p className="field-help">
            Switching re-indexes everything you have saved. Search keeps working while any download
            finishes; afterwards each item becomes searchable again as soon as it is re-indexed.
          </p>
          <button className="button secondary" disabled={busy} onClick={() => onSwitch(target)}>
            {switching && <LoaderCircle size={16} className="spin" />} Switch to {target.label}
          </button>
        </>
      )}
      <details className="search-model-add">
        <summary>Add your own model</summary>
        <p className="field-help">
          Any public text embedding model on Hugging Face with an ONNX export, up to{' '}
          {MAX_CUSTOM_MODEL_BYTES / 1e6} MB, such as one from “Xenova/” or “onnx-community/”. Its
          files are pinned and downloaded once, then it is tested with 8 sample questions on this
          device. Your own model searches text only and is experimental: it has not been tested on
          our search corpus. Nothing switches until you choose it.
        </p>
        <form onSubmit={submit} className="search-model-form">
          <label>
            Hugging Face model ID
            <input
              type="text"
              value={repo}
              placeholder="Xenova/bge-small-en-v1.5"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
          <label>
            Pooling
            <select
              value={pooling}
              disabled={busy}
              onChange={(e) => setPooling(e.target.value as AddOptions['pooling'])}
            >
              <option value="mean">Mean (most models)</option>
              <option value="cls">CLS (for example BGE and Arctic Embed)</option>
            </select>
          </label>
          <label>
            Query prefix (optional)
            <input
              type="text"
              value={queryPrefix}
              placeholder="query: "
              disabled={busy}
              onChange={(e) => setQueryPrefix(e.target.value)}
            />
          </label>
          <label>
            Document prefix (optional)
            <input
              type="text"
              value={documentPrefix}
              placeholder="passage: "
              disabled={busy}
              onChange={(e) => setDocumentPrefix(e.target.value)}
            />
          </label>
          <button className="button secondary" type="submit" disabled={busy || !repo.trim()}>
            {adding && <LoaderCircle size={16} className="spin" />} Download and test
          </button>
        </form>
        {adding && (
          <p className="field-help" role="status">
            {adding}
          </p>
        )}
        {addError && (
          <p className="field-help error-text" role="alert">
            {addError}
          </p>
        )}
      </details>
    </div>
  );
}
