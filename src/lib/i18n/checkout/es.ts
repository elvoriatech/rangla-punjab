/** Guest checkout copy — Spanish (Español). Loaded on its own chunk by
 *  `./load.ts`; `en.ts` supplies the shape (type-only import, so no
 *  English strings ride along). */
import type { CheckoutCopy } from "./en";

const es: CheckoutCopy = {
  yourOrder: "Tu pedido",
  placedBadge: (n) => `Pedido n.º ${n} ✓`,
  headingPlaced: (n) => `Pedido n.º ${n}`,
  close: "Cerrar el panel del pedido",

  each: (price) => `${price} cada uno`,
  oneLess: (name) => `Uno menos de ${name}`,
  oneMore: (name) => `Uno más de ${name}`,
  removeLine: (name) => `Quitar ${name} del pedido`,
  remove: "Quitar",
  total: "Total",
  vatIncluded: (rate, amount) => `IVA ${rate} % incluido ${amount}`,
  loyaltyEarn: (points) => `Ganarás ${points} puntos con este pedido`,
  loyaltySignIn: (points) => `Inicia sesión y gana ${points} puntos con este pedido`,
  clearCart: "Vaciar el pedido",
  addItems: "Añadir platos",

  orderTypeGroup: "Tipo de pedido",
  dineIn: "En el local",
  takeaway: "Recogida",
  delivery: "Entrega",

  tableNumber: "Número de mesa (opcional)",
  tableNumberPlaceholder: "p. ej. 12",
  yourName: "Tu nombre",
  phone: "Teléfono",
  phonePlaceholder: "+34 …",
  deliveryTime: "Hora de entrega",
  pickupTime: "Hora de recogida",
  asap: "Lo antes posible",
  email: "Correo electrónico (opcional): te enviaremos el recibo",
  emailPlaceholder: "tu@ejemplo.com",
  street: "Calle y número",
  zip: "C. P.",
  selectPlaceholder: "Selecciona…",
  city: "Ciudad / Municipio / Pueblo",
  cityPlaceholder: "— selecciona tu código postal —",
  deliveryNote: "Nota para la entrega (opcional)",
  deliveryNotePlaceholder: "p. ej. llamar dos veces, 3.º piso",

  addressTitle: "Dirección de entrega",
  addressChange: "Cambiar",

  timeNow: "Ahora",
  timeScheduled: "Programado",
  timeEarlier: "Antes",
  timeLater: "Después",

  freeDeliveryHere: "Entrega gratuita en esta zona 🎉",
  freeDeliveryFrom: (amount) => `Entrega gratuita a partir de ${amount}`,
  deliveryFee: (fee) => `Gastos de entrega ${fee}`,
  minimumOrderSuffix: (min) => ` · pedido mínimo ${min}`,
  minimumOrder: (min) => `Pedido mínimo ${min}`,
  belowMinimum: (min, missing) => `La entrega empieza en ${min}: faltan ${missing}.`,

  payGroup: "Hacer el pedido y pagar",
  paymentMethod: "Pago",
  payOrChoose: "o elige otra forma de pago",
  pay: "Pagar",
  placeOrder: "Hacer el pedido",
  card: "Tarjeta",
  paypal: "PayPal",
  payAtTable: "Pagar en la mesa",
  payAtPickup: "Pagar al recoger",
  cashToDriver: "Efectivo al repartidor",
  placing: "Enviando…",
  opening: "Abriendo…",
  explainerOnline:
    "Con tarjeta o PayPal se abre una página de pago segura en cuanto se guarda tu pedido; no se cobra nada hasta que lo confirmes allí. Después, el recibo se descarga automáticamente.",
  explainerDelivery: "Sin pago online: pagas al repartidor.",
  explainerPickup: "Sin pago online: pagas al recoger.",
  explainerDineIn: "Ahora no se paga: pagas en el restaurante.",
  weAccept: "Aceptamos",

  placedIntro: "Tu pedido ha llegado: el personal lo ve como",
  placedRef: (n) => `pedido n.º ${n}`,
  placedForTable: (table) => ` para la mesa ${table}`,
  placedCashTail: ", a pagar en el restaurante. Tu recibo se está descargando.",
  placedEmailTail: (email, pending) =>
    ` Enviaremos tu recibo a ${email}${pending ? " en cuanto se confirme el pago" : ""}.`,
  payOnline: (amount) => `Pagar online · ${amount}`,
  openingPayment: "Abriendo el pago…",
  openingPaypal: "Abriendo PayPal…",
  payWithPaypal: "Pagar con PayPal",
  trackOrder: "Seguir tu pedido",
  downloadReceipt: "Descargar el recibo (PDF)",
  startNewOrder: "Empezar un pedido nuevo",

  errPaypalOpen:
    "No se ha podido abrir PayPal: tu pedido está guardado; inténtalo con el botón de abajo o paga en el restaurante.",
  errCardOpen:
    "No se ha podido abrir el pago con tarjeta: tu pedido está guardado; inténtalo con el botón de abajo o paga en el restaurante.",
  errPayRetry: "Sin conexión: tu pedido está guardado; vuelve a intentar el pago abajo.",
  errWalletPay:
    "El pago con la cartera no se ha completado: tu pedido está guardado; elige abajo otra forma de pago.",
  errUnknownItems:
    "La carta ha cambiado mientras hacías el pedido. Revisa los platos e inténtalo de nuevo.",
  errRateLimited: "Demasiados pedidos desde esta conexión: espera un minuto.",
  errTypeNotAvailable: "Este tipo de pedido acaba de desactivarse: elige otra opción.",
  errOutsideArea: "Lo sentimos, esa dirección está fuera de la zona de entrega.",
  errBelowMinimum: (min) => `La entrega empieza en ${min}: añade algo más.`,
  errInvalidTime: "Esa hora acaba de pasar o está fuera del horario: elige otra.",
  errGeneric: "El pedido no se ha completado. Inténtalo de nuevo.",
  errNoConnection: "Sin conexión: comprueba tu red e inténtalo de nuevo.",

  add: "+ Añadir",
  added: "Añadido ✓",
  addAria: (name) => `Añadir ${name} al pedido`,
};

export default es;
