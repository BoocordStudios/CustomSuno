import { EXPORT_FORMATS, type ExportFormat } from './audio-export';
import { translator, type Language } from './i18n';

export default function ExportFormatSelect({ value, onChange, disabled, language }: {
  language: Language;
  value: ExportFormat; onChange: (format: ExportFormat) => void; disabled?: boolean;
}) {
  const t = translator(language);
  return <label className="range-label export-format"><span>{t("Format")}</span><select aria-label={t("Exportformat")} value={value} disabled={disabled} onChange={event => onChange(event.target.value as ExportFormat)}>
    {EXPORT_FORMATS.map(format => <option key={format.value} value={format.value}>{t(format.label)}</option>)}
  </select></label>;
}
