/** Guest checkout copy — Arabic (Modern Standard). Loaded on its own chunk by
 *  `./load.ts`; `en.ts` supplies the shape (type-only import, so no
 *  English strings ride along). */
import type { CheckoutCopy } from "./en";

/* Latin brand names (PayPal, PDF) stay Latin — that is how they appear
   on Arabic-language checkouts everywhere. */
const ar: CheckoutCopy = {
  yourOrder: "طلبك",
  placedBadge: (n) => `طلب رقم ${n} ✓`,
  headingPlaced: (n) => `طلب رقم ${n}`,
  close: "إغلاق لوحة الطلب",

  each: (price) => `${price} للقطعة`,
  oneLess: (name) => `إنقاص ${name} بمقدار واحد`,
  oneMore: (name) => `زيادة ${name} بمقدار واحد`,
  removeLine: (name) => `إزالة ${name} من الطلب`,
  remove: "إزالة",
  total: "الإجمالي",
  vatIncluded: (rate, amount) => `شامل ضريبة القيمة المضافة ${rate}% ${amount}`,
  loyaltyEarn: (points) => `ستحصل على ${points} نقطة مع هذا الطلب`,
  loyaltySignIn: (points) => `سجّل الدخول لتحصل على ${points} نقطة مع هذا الطلب`,
  clearCart: "إفراغ الطلب",
  addItems: "إضافة أصناف",

  orderTypeGroup: "نوع الطلب",
  dineIn: "في المطعم",
  takeaway: "استلام",
  delivery: "توصيل",

  tableNumber: "رقم الطاولة (اختياري)",
  tableNumberPlaceholder: "مثال: 12",
  yourName: "اسمك",
  phone: "رقم الهاتف",
  phonePlaceholder: "+49 …",
  deliveryTime: "وقت التوصيل",
  pickupTime: "وقت الاستلام",
  asap: "في أقرب وقت ممكن",
  email: "البريد الإلكتروني (اختياري) — سنرسل إليك الإيصال",
  emailPlaceholder: "you@example.com",
  street: "الشارع ورقم المبنى",
  zip: "الرمز البريدي",
  selectPlaceholder: "اختر…",
  city: "المدينة / البلدية / القرية",
  cityPlaceholder: "— اختر الرمز البريدي —",
  deliveryNote: "ملاحظة للتوصيل (اختياري)",
  deliveryNotePlaceholder: "مثال: اطرق الجرس مرتين، الطابق الثالث",

  addressTitle: "عنوان التوصيل",
  addressChange: "تغيير",

  timeNow: "الآن",
  timeScheduled: "مجدول",
  closedPreorderNote: "نحن مغلقون حالياً — يمكنكم الطلب مسبقاً لوقت لاحق اليوم.",
  closedDineIn: "الطلب على الطاولة متاح خلال ساعات العمل فقط.",
  timeEarlier: "أبكر",
  timeLater: "لاحقاً",

  freeDeliveryHere: "التوصيل مجاني إلى هذه المنطقة 🎉",
  freeDeliveryFrom: (amount) => `التوصيل مجاني ابتداءً من ${amount}`,
  deliveryFee: (fee) => `رسوم التوصيل ${fee}`,
  minimumOrderSuffix: (min) => ` · الحد الأدنى للطلب ${min}`,
  minimumOrder: (min) => `الحد الأدنى للطلب ${min}`,
  belowMinimum: (min, missing) => `يبدأ التوصيل من ${min} — أضف ${missing} أخرى.`,

  payGroup: "إتمام الطلب والدفع",
  paymentMethod: "الدفع",
  payOrChoose: "أو اختر طريقة دفع أخرى",
  pay: "ادفع",
  placeOrder: "أرسل الطلب",
  card: "بطاقة",
  paypal: "PayPal",
  payAtTable: "الدفع على الطاولة",
  payAtPickup: "الدفع عند الاستلام",
  cashToDriver: "نقدًا للسائق",
  placing: "جارٍ الإرسال…",
  opening: "جارٍ الفتح…",
  explainerOnline:
    "تفتح البطاقة وPayPal صفحة دفع آمنة بمجرد حفظ طلبك، ولا يُخصم أي مبلغ قبل تأكيدك هناك. يُنزَّل الإيصال تلقائيًا بعد ذلك.",
  explainerDelivery: "لا يوجد دفع عبر الإنترنت — تدفع للسائق.",
  explainerPickup: "لا يوجد دفع عبر الإنترنت — تدفع عند الاستلام.",
  explainerDineIn: "لا دفع الآن — تدفع في المطعم.",
  weAccept: "نقبل",

  placedIntro: "وصل طلبك — يراه الفريق باسم",
  placedRef: (n) => `الطلب رقم ${n}`,
  placedForTable: (table) => ` للطاولة ${table}`,
  placedCashTail: "، ويُدفع في المطعم. يجري تنزيل إيصالك.",
  placedEmailTail: (email, pending) =>
    ` سنرسل إيصالك إلى ${email}${pending ? " بمجرد تأكيد الدفع" : ""}.`,
  payOnline: (amount) => `الدفع عبر الإنترنت · ${amount}`,
  openingPayment: "جارٍ فتح صفحة الدفع…",
  openingPaypal: "جارٍ فتح PayPal…",
  payWithPaypal: "الدفع عبر PayPal",
  trackOrder: "تتبّع طلبك",
  downloadReceipt: "تنزيل الإيصال (PDF)",
  startNewOrder: "ابدأ طلبًا جديدًا",

  errPaypalOpen: "تعذّر فتح PayPal — طلبك محفوظ؛ جرّب الزر أدناه أو ادفع في المطعم.",
  errCardOpen: "تعذّر فتح الدفع بالبطاقة — طلبك محفوظ؛ جرّب الزر أدناه أو ادفع في المطعم.",
  errPayRetry: "لا يوجد اتصال — طلبك محفوظ؛ أعد محاولة الدفع أدناه.",
  errWalletPay: "لم تتم عملية الدفع بالمحفظة — طلبك محفوظ؛ اختر طريقة دفع أخرى أدناه.",
  errUnknownItems: "تغيّرت قائمة الطعام أثناء طلبك. راجع الأصناف وحاول مرة أخرى.",
  errRateLimited: "طلبات كثيرة من هذا الاتصال — يُرجى الانتظار دقيقة.",
  errTypeNotAvailable: "تم إيقاف هذا النوع من الطلبات للتو — اختر خيارًا آخر.",
  errOutsideArea: "عذرًا، هذا العنوان خارج منطقة التوصيل.",
  errBelowMinimum: (min) => `يبدأ التوصيل من ${min} — أضف المزيد قليلًا.`,
  errInvalidTime: "هذا الوقت انقضى للتو أو خارج ساعات العمل — اختر وقتًا آخر.",
  errVenueClosed: "لقد أغلقنا للتو — اختاروا وقتاً لاحقاً اليوم أو حاولوا غداً.",
  errGeneric: "لم يكتمل الطلب. يُرجى المحاولة مرة أخرى.",
  errNoConnection: "لا يوجد اتصال — تحقق من الشبكة وحاول مرة أخرى.",

  add: "+ إضافة",
  added: "تمت الإضافة ✓",
  addAria: (name) => `إضافة ${name} إلى الطلب`,

  requiredMark: "(حقل مطلوب)",
  requiredLegend: "* حقل مطلوب",
};

export default ar;
