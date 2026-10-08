export const catalogs = {
  en: { title:'MP Frontend', catalog:'Catalog', refresh:'Refresh', loading:'Loading', unavailable:'Backend is unavailable. Try again.', empty:'No records found.', previous:'Previous', next:'Next', page:'Page', language:'Language', brand:'Brand', mode:'Appearance', light:'Light', dark:'Dark', system:'System', docs:'API documentation', source:'Connected to MP Core', search:'Search', apply:'Apply', readOnly:'Read-only public catalog', fields:'Fields', true:'Yes', false:'No', detail:'Details', back:'Back', save:'Save', forbidden:'This operation is not permitted.', invalid:'Check the permitted fields.', remoteChange:'Data changed remotely. Your edits are preserved.', skipToContent:'Skip to content', navigation:'Main navigation' },
  ar: { title:'MP Frontend', catalog:'الكتالوج', refresh:'تحديث', loading:'جار التحميل', unavailable:'الخدمة غير متاحة. حاول مرة أخرى.', empty:'لا توجد سجلات.', previous:'السابق', next:'التالي', page:'الصفحة', language:'اللغة', brand:'العلامة', mode:'المظهر', light:'فاتح', dark:'داكن', system:'النظام', docs:'توثيق الواجهة', source:'متصل بـ MP Core', search:'بحث', apply:'تطبيق', readOnly:'كتالوج عام للقراءة فقط', fields:'الحقول', true:'نعم', false:'لا', detail:'التفاصيل', back:'رجوع', save:'حفظ', forbidden:'هذه العملية غير مسموحة.', invalid:'تحقق من الحقول المسموحة.', remoteChange:'تغيرت البيانات. تم الاحتفاظ بتعديلاتك.', skipToContent:'تخطَّ إلى المحتوى', navigation:'التنقل الرئيسي' }
} as const;
export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof catalogs.en;
export function locale(value: unknown): Locale { return value === 'ar' ? 'ar' : 'en'; }
export function direction(value: Locale): 'ltr' | 'rtl' { return value === 'ar' ? 'rtl' : 'ltr'; }
export function translator(value: Locale): (key:MessageKey)=>string { return key => catalogs[value][key] ?? catalogs.en[key]; }
export function formatValue(value: unknown, language: Locale): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return translator(language)(value ? 'true' : 'false');
  if (typeof value === 'number') return new Intl.NumberFormat(language, {maximumFractionDigits: 8}).format(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
