// BestRunning · banco de frases del coach, números en palabras y clips para packs de voz.
// SIN DOM: se importa desde Node (tests y herramientas) y desde el navegador.
import { hashStr } from '../core/utils.js';
import { ZONES } from '../training/levels.js';

/*
 * Marcadores admitidos en las plantillas:
 *   {speed} {incline} {vam}  velocidad / inclinación / VAM ('11,5', '13')
 *   {km}                     kilómetros ('3', '4,2')
 *   {dur} {lead}             duración en palabras ('dos minutos', 'diez segundos')
 *   {pace}                   ritmo 'm:ss' (se lee 'cinco minutos y trece segundos')
 *   {i} {n} {stage} {min}    enteros (serie, total, escalón, minutos)
 *   {zone}                   nombre de zona ('Correr rápido'); solo al inicio de frase
 *   {title} {name}           título de la clase / nombre del usuario
 * Los ids de frase son `${categoría}.${índice}`: añade frases al final de cada lista para no moverlos.
 */
const BANK = {
  intro: [
    '¡Hola, {name}! Hoy toca {title}: {min} minutos. Arrancamos suave, a {speed}.',
    'Bienvenido a {title}. Son {min} minutos y empezamos calentando a {speed}.',
    '¡Vamos, {name}! {title}, {min} minutos de trabajo bien hecho. Primera velocidad: {speed}.',
    'Clase de hoy: {title}. {min} minutos para ponerte un poco más en forma. Empieza a {speed}, sin prisa.',
    'Muy buenas. Clase {title}, {min} minutos. Pon la cinta a {speed} y suelta el cuerpo.',
    'Aquí empieza {title}. Tenemos {min} minutos por delante; primero, {speed} para entrar en calor.',
    '¡Arriba, {name}! {min} minutos de {title}. Comenzamos a {speed}, tranquilo.',
    'Si no lo has hecho ya, inicia Cinta de correr en el reloj. Hoy: {title}, {min} minutos. Arrancamos a {speed}.',
    'Lo más difícil era subirse a la cinta, y eso ya está. {title}: {min} minutos. Empezamos a {speed}.',
    'Hoy, {title}. {min} minutos, cada cambio avisado con tiempo y yo contigo todo el rato. Primera velocidad: {speed}.',
    'Empieza {title}. {min} minutos que te van a sentar de maravilla. Cinta a {speed} y a rodar.',
    '¿Listo, {name}? {title}, {min} minutos. De momento, {speed} y respiración tranquila.',
  ],
  testIntro: [
    'Hoy toca test, {name}. Escalones de un minuto, cada uno un poco más rápido. Empezamos calentando a {speed}.',
    'Día de test. Calentamos a {speed} y luego subimos medio kilómetro por hora cada minuto. Cuando no puedas más, pulsa No puedo más.',
    'Test de velocidad aeróbica máxima. Sin heroicidades al principio: calentamos a {speed}; el test se gana en los últimos escalones.',
    'Hoy medimos tu motor. Calentamiento a {speed} y después escalones de un minuto hasta donde llegues. Tú marcas el límite.',
    'Test escalonado. Empezamos suave a {speed}; cada minuto subirá la cinta. Dalo todo, pero con cabeza.',
    'Toca test, y con él, velocidades nuevas. Calentamos a {speed}. Luego, aprieta hasta el último escalón que puedas completar.',
  ],
  warmup: [
    'Subimos un puntito: {speed}. Seguimos calentando.',
    'Un poco más: {speed}. El cuerpo ya va entrando en calor.',
    'Calentamiento, {speed}. Zancada corta y relajada.',
    'Ahora {speed}. Nada de prisas, estamos despertando las piernas.',
    'Siguiente escalón del calentamiento: {speed}.',
    'Vamos a {speed}. Nota cómo se va soltando la cadera.',
    'Calentamos con calma. Suelta los hombros y deja que los brazos se balanceen.',
    'Estos minutos no se negocian: un buen calentamiento es lo que te deja apretar luego.',
    'Respira por la nariz si puedes. Si te cuesta, es que vas demasiado rápido para calentar.',
    'Mueve un poco los tobillos y relaja las manos. Vamos poco a poco.',
    'Aprovecha para colocarte bien: centrado en la cinta y mirada al frente.',
    'Tranquilo, que lo bueno viene después. Ahora toca entrar en calor.',
  ],
  speedUp: [
    'En {lead}, sube a {speed}.',
    'Prepárate: en {lead} subimos a {speed}.',
    'Atento, en {lead} toca acelerar a {speed}.',
    'Ve llevando el dedo al botón: en {lead}, {speed}.',
    'Cambio en {lead}: subimos a {speed}.',
    'Te aviso con tiempo: en {lead}, {speed}.',
    'Se viene subida. En {lead}, {speed}.',
    'En {lead} aprietas un poco más: {speed}.',
  ],
  slowDown: [
    'En {lead}, baja a {speed}.',
    'Atento, en {lead} bajamos a {speed}.',
    'En {lead} levantamos el pie: {speed}.',
    'Cambio en {lead}: baja a {speed}.',
    'Prepárate para bajar a {speed} en {lead}.',
    'En {lead}, frena a {speed}. Ya casi está.',
    'Te aviso: en {lead}, {speed}, más tranquilo.',
    'En {lead} reducimos a {speed}. Aguanta hasta entonces.',
  ],
  toSprint: [
    'Prepárate para el sprint: en {lead}, {speed}.',
    'En {lead}, sprint a {speed}. Todo lo que tengas.',
    'Viene lo bueno. En {lead}, {speed} a tope.',
    'Atento, en {lead} sprint: {speed}. Brazos fuertes.',
    'En {lead}, la más rápida: {speed}. Prepárate.',
    'Respira hondo: en {lead}, sprint a {speed}.',
    'Sprint en {lead}: {speed}. Que se note.',
    'Dedo al botón: en {lead}, sprint a {speed}.',
  ],
  toRecover: [
    '{lead} y recuperas: baja a {speed}.',
    'Aguanta {lead} y bajamos a {speed}.',
    'En {lead}, recuperación a {speed}. Ya lo tienes.',
    '{lead} más y respiras: {speed}.',
    'Ya casi. En {lead}, baja a {speed} y recupera.',
    'En {lead}, premio: {speed} para recuperar.',
    '{lead} y descanso activo a {speed}.',
    'Lo tienes: en {lead}, bajamos a {speed}.',
  ],
  toFast: [
    'En {lead}, ritmo rápido: {speed}.',
    'Atento, en {lead} subimos a ritmo rápido, {speed}.',
    'En {lead}, {speed}. Toca correr rápido.',
    'Prepárate para apretar: en {lead}, {speed}.',
    'En {lead} entramos en la zona naranja: {speed}.',
    'Cambio de marcha en {lead}: {speed}.',
    'En {lead}, rápido a {speed}. Zancada ágil.',
  ],
  toRun: [
    'En {lead}, a correr: {speed}.',
    'En {lead}, ritmo de carrera: {speed}.',
    'Atento, en {lead} pasamos a ritmo de carrera: {speed}.',
    'En {lead}, {speed}. A correr con soltura.',
    'Prepárate: en {lead}, ritmo de crucero a {speed}.',
    'En {lead} pasamos a correr: {speed}.',
  ],
  toJog: [
    'En {lead}, trote a {speed}.',
    'En {lead}, trotecito: {speed}.',
    'Atento, en {lead} trote suave a {speed}.',
    'En {lead}, {speed}. Trote cómodo.',
    'Prepárate para trotar a {speed} en {lead}.',
    'En {lead} pasamos a trote: {speed}.',
  ],
  cooldown: [
    'Vuelta a la calma: {speed}. Lo más duro ya está hecho.',
    'Bajamos a {speed}. Ahora toca soltar y respirar.',
    'Ya está, {speed}. Deja que el pulso baje poco a poco.',
    'Vuelta a la calma a {speed}. Disfruta de estos minutos, te los has ganado.',
    '{speed} y a recuperar. Hombros sueltos, respiración larga.',
    'Calma, {speed}. Lo has hecho de diez.',
    'Respira hondo y suelta el aire despacio. El trabajo ya está hecho.',
    'Nota cómo baja el pulso. Eso también es entrenar.',
    'Al terminar, unos minutos de estiramientos suaves: gemelos, cuádriceps y cadera.',
    'Bebe agua al bajar de la cinta. Hoy has sumado, y mucho.',
    'No pares de golpe: estos minutos suaves ayudan a que mañana tengas las piernas frescas.',
  ],
  now: [
    '¡Ahora! {zone}, {speed}. {dur}.',
    '¡Ya! {speed}. {zone} durante {dur}.',
    '¡Cambio! {zone} a {speed}, {dur}.',
    '¡Vamos! {speed} durante {dur}.',
    '¡Ahora! {speed}. Son {dur}.',
    '¡Ya está aquí! {zone}, {speed}. {dur} por delante.',
    '¡Dale! {speed} en la cinta. {dur}.',
    '¡Allá vamos! {zone}: {speed}, {dur}.',
    '¡Ahora sí! {speed} durante {dur}.',
    '¡Cambio! {speed}. {dur} así.',
  ],
  nowSprint: [
    '¡Sprint! {speed}. {dur} a tope.',
    '¡Ahora, sprint! {speed}, brazos fuertes. {dur}.',
    '¡Vamos, vamos! {speed}. {dur} y lo tienes.',
    '¡A tope! {speed} durante {dur}.',
    '¡Sprint a {speed}! {dur}, no te guardes nada.',
    '¡Ya! {speed}. Rodillas arriba, {dur}.',
  ],
  nowRecover: [
    '¡Bien hecho! Recupera a {speed}. {dur}.',
    'Respira. {speed} durante {dur}.',
    'Recuperación: {speed}. Tienes {dur} para soltar.',
    '¡Eso es! Baja a {speed} y recupera. {dur}.',
    'Muy bien. {speed}, {dur} de respiro.',
    'Trote de recuperación a {speed}. {dur}.',
  ],
  repInfo: [
    'Serie {i} de {n}.',
    'Vamos por la {i} de {n}.',
    'Repetición {i} de {n}.',
    'Esta es la {i} de {n}.',
    'Ya estás en la {i} de {n}.',
    '{i} de {n}.',
    'Serie número {i}, de {n}.',
  ],
  repFirst: [
    'Primera de {n}. Encuentra el ritmo.',
    'Arrancamos la serie uno de {n}.',
    'Primera serie de {n}. Sin pasarte, que quedan más.',
    'Serie uno de {n}. Tranquilo, que esto es largo.',
    'Empezamos: primera de {n}.',
    'La primera de {n}. Que sea limpia.',
  ],
  repLast: [
    '¡Última serie! Vacíalo todo.',
    '¡Es la última, {name}! A por ella.',
    'Última repetición. Aquí se ganan las piernas nuevas.',
    '¡La última! Lo que te quede, aquí.',
    'Última serie. Termina mejor de lo que empezaste.',
    '¡Última! Después de esta, a presumir.',
    'Serie {n} de {n}: la última. ¡Vamos!',
  ],
  halfSegment: [
    'Mitad de este tramo. Quedan {dur}.',
    'Vas por la mitad. {dur} más así.',
    'Medio camino en este bloque: {dur} y cambiamos.',
    'Ya está la mitad. Quedan {dur}, mantén el ritmo.',
    'Mitad superada. {dur} para cerrar este tramo.',
    'Ecuador del bloque. Te quedan {dur}.',
    'La mitad ya es tuya. Solo {dur} más.',
  ],
  last30: [
    '¡Últimos treinta segundos, aguanta!',
    'Treinta segundos. ¡Mantén!',
    'Medio minuto y lo tienes.',
    'Últimos treinta: zancada firme y brazos activos.',
    '¡Treinta segundos más, no aflojes!',
    'Quedan treinta segundos. Esto ya es tuyo.',
    '¡Medio minuto! Cara relajada y a aguantar.',
  ],
  last10: [
    '¡Diez segundos!',
    '¡Diez más, todo!',
    '¡Diez segundos, no aflojes ahora!',
    '¡Últimos diez!',
    '¡Diez y se acaba!',
    '¡Diez segundos, vamos!',
  ],
  halfWorkout: [
    '¡Mitad del entrenamiento! Lo que queda ya es cuesta abajo.',
    'Ecuador de la clase, {name}. Vas como un reloj.',
    'Ya llevamos la mitad. Lo que viene, con la confianza de lo que ya has hecho.',
    '¡Medio entrenamiento hecho! Sigue así.',
    'Mitad de la clase. Cuerpo suelto, cabeza aquí.',
    'La mitad, conseguida. A por la segunda parte.',
    'Estamos en la mitad. Bebe un trago si lo necesitas y seguimos.',
  ],
  lastBlock: [
    'Último bloque. Esto se acaba, dalo todo.',
    'Entramos en el último bloque. Aquí es donde se nota el trabajo de semanas.',
    'Último bloque, {name}. Lo que te quede, ahora.',
    'Recta final de la clase. ¡A por ella!',
    'Último bloque: termina fuerte y con buena técnica.',
    'Ya solo queda este bloque. Después, vuelta a la calma.',
    'Última parte dura. Vamos a cerrarla bien.',
  ],
  finish: [
    '¡Clase terminada! Enhorabuena, {name}.',
    '¡Y hecho! Otra sesión en el bolsillo.',
    '¡Terminado! Hoy has sumado, y mucho.',
    'Fin de la clase. Así se construye la forma: día a día.',
    '¡Lo tienes! Clase completada. Para el reloj y a estirar.',
    '¡Enhorabuena! Entrenamiento completado. Te has ganado la ducha.',
    '¡Clase terminada! {km} kilómetros en {min} minutos. Enorme.',
    '¡Hecho! {km} kilómetros en {min} minutos. Apúntatelo.',
    'Fin del entrenamiento: {km} kilómetros y {min} minutos de trabajo bien hecho.',
    '¡Terminado, {name}! {km} kilómetros en {min} minutos. Así da gusto.',
    '{km} kilómetros en {min} minutos. Para el Apple Watch y a estirar. ¡Enhorabuena!',
    '¡Lo has clavado! {km} kilómetros en {min} minutos.',
  ],
  finishPartial: [
    '¡Buen trabajo! Hoy también suma.',
    'Sesión terminada. Lo que has hecho hoy cuenta.',
    'Hasta aquí por hoy. Buen trabajo, {name}.',
    'Buen trabajo: {km} kilómetros en {min} minutos.',
    '{km} kilómetros en {min} minutos. Hoy también suma.',
    'Hasta aquí por hoy: {km} kilómetros en {min} minutos. Bien hecho.',
  ],
  finishStats: [
    'Has hecho {km} kilómetros en {min} minutos.',
    'Balance de hoy: {km} kilómetros en {min} minutos.',
    '{km} kilómetros en {min} minutos. Guárdalo con tus sensaciones.',
    'Hoy: {km} kilómetros y {min} minutos. Buen trabajo.',
    'Total: {km} kilómetros en {min} minutos.',
    'Te llevas {km} kilómetros en {min} minutos.',
  ],
  km: [
    'Kilómetro {km}. Ritmo medio, {pace} por kilómetro.',
    '¡{km} kilómetros! Vas a {pace} el kilómetro.',
    'Ya llevas {km} kilómetros. Buen ritmo.',
    'Kilómetro {km} completado.',
    '{km} kilómetros en las piernas. Sigue así.',
    'Otro kilómetro: van {km}. Ritmo medio de {pace}.',
    'Kilómetro {km}. Así se suma.',
    '¡Y van {km}! Cada uno cuenta.',
  ],
  pause: [
    'Pausa. Respira, aquí te espero.',
    'Paramos un momento. Cuando quieras, seguimos.',
    'En pausa. Aprovecha para beber un poco.',
    'Pausa. Sin prisa, el entrenamiento no se va a ningún sitio.',
    'Pausado. Si bajas de la cinta, hazlo con cuidado.',
    'Tómate tu tiempo. Te espero aquí.',
    'Pausa. Ojo: antes de bajarte, para la cinta.',
  ],
  resume: [
    '¡Seguimos! Cinta a {speed}.',
    '¡De vuelta! Retomamos a {speed}.',
    'Volvemos al lío: {speed}.',
    '¡Seguimos! Vuelve a subir a {speed} con calma.',
    'Reanudamos. {speed} y a por ello.',
    '¡Arriba! Seguimos donde lo dejamos.',
    '¡Vamos allá otra vez!',
  ],
  adjust: [
    'Hecho: {speed}.',
    'Anotado, {speed}.',
    '{speed}. Recibido.',
    'Vale, {speed}. Yo me adapto.',
    'Perfecto, {speed}.',
    'Apuntado: {speed}. Lo tendré en cuenta.',
    'Cambiado a {speed}.',
  ],
  testStage: [
    'Escalón {stage}: {speed}.',
    'Escalón {stage}. Sube a {speed}.',
    'Escalón {stage}, {speed}. Paso firme.',
    'Nuevo escalón, el {stage}: {speed}.',
    '¡Escalón {stage}! {speed}. Sigue.',
    'Escalón {stage}: {speed}. Un minuto más.',
    'Subimos al escalón {stage}: {speed}. Tú puedes.',
  ],
  testNext: [
    'En {lead}, escalón {stage}: {speed}.',
    'Atento, en {lead} sube al escalón {stage}, {speed}.',
    'Escalón {stage} en {lead}: {speed}.',
    'En {lead} subimos: {speed}.',
    'Prepárate: en {lead}, {speed}.',
    'En {lead}, siguiente escalón: {speed}.',
  ],
  testEnd: [
    '¡Test terminado! Gran trabajo. Baja a {speed} y recupera.',
    '¡Hasta aquí! Has llegado al escalón {stage}. Ahora, vuelta a la calma.',
    'Test completado. Lo que acabas de hacer vale oro: ahora sabemos tus nuevas velocidades.',
    '¡Fin del test! Respira, baja a {speed} y disfruta: lo peor ya pasó.',
    '¡Enorme! Test terminado. Al acabar verás tus nuevas velocidades.',
    'Test cerrado. Vuelta a la calma a {speed}, te lo has ganado.',
    '¡Test terminado! Velocidad aeróbica máxima: {vam}. Ahora, a recuperar.',
    'Fin del test, y qué test. Tu velocidad aeróbica máxima sale en {vam}. Baja a {speed}.',
  ],
  'tips.form': [
    'Mira al frente, no a los pies. La cinta no se va a escapar.',
    'Brazos a noventa grados, de delante hacia atrás, sin cruzar el pecho.',
    'Pisa debajo de la cadera, no por delante. Zancada corta y rápida.',
    'Hombros abajo. Si están subiendo hacia las orejas, déjalos caer.',
    'Corre en el centro de la cinta, sin pegarte al frontal.',
    'Manos sueltas, como si llevaras algo frágil entre los dedos.',
    'Empuja el suelo hacia atrás; no rebotes hacia arriba.',
    'Pasos ligeros: cuanto menos suene la cinta, mejor vas.',
    'Tronco alto, con una leve inclinación desde los tobillos, no desde la cintura.',
    'No te agarres a las barras: los brazos también corren.',
    'Cadencia alta y pasos cortos. Eficiencia antes que fuerza.',
    'Rodillas sueltas y pie que cae suave. Nada de taconazos.',
  ],
  'tips.breath': [
    'Respira por la nariz y la boca a la vez, sin forzar.',
    'Suelta bien el aire; el siguiente entra solo.',
    'Prueba a inspirar en tres pasos y soltar en dos.',
    'Si puedes decir una frase corta, vas bien. Si no, respira hondo y suelta los hombros.',
    'Respira con la tripa, no solo con el pecho.',
    'Exhala largo, como si soplaras una vela lejana.',
    'Cuando aprieta, la respiración manda: profunda y con ritmo.',
    'Respira en dos tiempos: dentro, dentro; fuera, fuera.',
    'Si notas flato, suelta el aire con fuerza y afloja un poco el ritmo de brazos.',
  ],
  'tips.mind': [
    'Solo piensa en este bloque. El siguiente ya llegará.',
    'No cuentes lo que falta; gana el próximo minuto.',
    'Cuando la cabeza dice basta, a las piernas aún les queda gasolina.',
    'Cara relajada: aprieta la cinta, no la mandíbula.',
    'Sonríe, aunque sea un poco. El cerebro se lo cree y todo cuesta menos.',
    'Hoy estás entrenando al corredor que serás dentro de tres meses.',
    'Fija la mirada en un punto y quédate aquí, en este momento.',
    'Lo que sientes es tu corazón haciéndose más fuerte.',
    'La constancia gana a la intensidad. Y hoy estás siendo constante.',
    'Cuenta diez zancadas con buena técnica. Y luego otras diez.',
  ],
  'motivation.general': [
    'Muy bien, {name}. Así, con cabeza.',
    'Vas genial. Constante y sin prisa.',
    'Esto es justo lo que te hace mejor corredor.',
    'Qué buen ritmo llevas hoy.',
    'Cada minuto de hoy cuenta. Y los estás sumando.',
    'Así se hace: sin aspavientos, trabajo del bueno.',
    'Tu yo de la semana que viene te lo va a agradecer.',
    'Me gusta lo que veo: zancada estable y cabeza tranquila.',
    'Sigue así, {name}. Esto ya es costumbre.',
    'Ni la cinta se esperaba este ritmo hoy.',
    'Paso a paso se llega lejísimos. Y tú vas lanzado.',
    'Esto no lo hace cualquiera. Tú, sí.',
  ],
  'motivation.hard': [
    '¡Aguanta! Esto es lo que te hace más rápido.',
    'Duele un poco, y eso significa que está funcionando.',
    '¡Vamos, {name}! Brazos fuertes y adelante.',
    'Aquí se gana la forma. ¡No aflojes!',
    'Lo estás haciendo. Respira y mantén.',
    'Este esfuerzo es tu próxima subida de nivel.',
    '¡Fuerte! Un poco más y recuperas.',
    'Cuerpo alto, mirada al frente y a por ello.',
    'Es duro porque vale la pena. ¡Sigue!',
    '¡Eso es! Esto es correr de verdad.',
    'No lo pienses: corre. ¡Vamos!',
  ],
  hydration: [
    'Buen momento para un trago de agua. Pequeñito, sin parar.',
    'Hidratación: un sorbo y seguimos.',
    'Si tienes la botella a mano, bebe un poco ahora.',
    'Un trago de agua ahora te lo agradecerán las piernas dentro de veinte minutos.',
    'Bebe un poco. Con calma, sin perder el paso.',
    'Toca agua, sin parar la cinta: un sorbo corto.',
    'Recuerda beber. En la cinta se suda más de lo que parece.',
  ],
  inclineUp: [
    'En {lead}, sube la inclinación al {incline} por ciento.',
    'Viene cuesta: en {lead}, inclinación al {incline} por ciento.',
    'Atento, en {lead} subimos la inclinación a {incline}.',
    'En {lead}, cuesta al {incline} por ciento. Pasos cortos.',
    'Prepárate para subir: en {lead}, inclinación {incline}.',
    'En {lead} empieza la subida: {incline} por ciento.',
    'En {lead}, inclinación {incline}.',
  ],
  inclineDown: [
    'En {lead}, baja la inclinación al {incline} por ciento.',
    'En {lead} se suaviza la cuesta: {incline} por ciento.',
    'Atento, en {lead} bajamos la inclinación a {incline}.',
    'En {lead}, inclinación a {incline}. Respira.',
    'En {lead} aflojamos la cuesta: {incline} por ciento.',
    'Prepárate: en {lead}, inclinación {incline}.',
    'En {lead}, baja a {incline}.',
  ],
  inclineFlat: [
    'En {lead}, quita la inclinación: volvemos al llano.',
    'En {lead}, inclinación a cero.',
    'En {lead} se acaba la cuesta: cinta plana.',
    'Atento: en {lead}, sin inclinación.',
    'En {lead}, llano otra vez.',
    'Fin de la subida en {lead}: inclinación a cero.',
  ],
  nowIncline: [
    'Inclinación al {incline} por ciento.',
    'Inclinación {incline}.',
    'Pon la inclinación en {incline}.',
    'Inclinación a {incline} por ciento.',
    'Cinta al {incline} por ciento de inclinación.',
    'Ajusta la inclinación: {incline}.',
  ],
  nowFlat: [
    'Inclinación a cero.',
    'Cinta plana.',
    'Sin inclinación.',
    'Quita la inclinación.',
    'Llano otra vez.',
    'Inclinación fuera.',
  ],
  countdownGo: [
    '¡Vamos!',
    '¡Ya!',
    '¡A correr!',
    '¡Dale!',
    '¡Empezamos!',
    '¡Allá vamos!',
  ],
  preview: [
    'Hola, {name}. Así sonaré en tus entrenamientos.',
    'Aquí tu coach. Te avisaré de cada cambio con tiempo.',
    '¡Hola! Esta es mi voz. Vamos a entrenar juntos.',
    'Así suena tu coach, {name}. Listo cuando tú lo estés.',
    'Prueba de voz: te iré cantando velocidades y tiempos.',
    'Hola, soy tu coach. Yo aviso y tú corres.',
  ],
};

/** Categorías mínimas exigidas por la especificación (§7). */
export const REQUIRED_CATEGORIES = [
  'intro', 'warmup', 'speedUp', 'slowDown', 'toSprint', 'toRecover', 'toFast', 'toRun', 'toJog', 'cooldown', 'now',
  'repInfo', 'halfSegment', 'last30', 'last10', 'halfWorkout', 'lastBlock', 'finish', 'km', 'pause', 'resume',
  'adjust', 'testStage', 'testEnd', 'tips.form', 'tips.breath', 'tips.mind', 'motivation.general',
  'motivation.hard', 'hydration', 'inclineUp', 'inclineDown',
];

export const PLACEHOLDERS = ['speed', 'incline', 'vam', 'km', 'dur', 'lead', 'pace', 'i', 'n', 'stage', 'min', 'zone', 'title', 'name'];

/** Banco congelado. Claves planas ('tips.form') y alias anidados no enumerables (PHRASES.tips.form). */
export const PHRASES = (() => {
  const out = {};
  for (const [k, list] of Object.entries(BANK)) out[k] = Object.freeze(list.slice());
  const groups = {};
  for (const k of Object.keys(out)) {
    const dot = k.indexOf('.');
    if (dot > 0) (groups[k.slice(0, dot)] ||= {})[k.slice(dot + 1)] = out[k];
  }
  for (const [g, obj] of Object.entries(groups)) Object.defineProperty(out, g, { value: Object.freeze(obj), enumerable: false });
  return Object.freeze(out);
})();

/* ───────────── Números en palabras (es-ES) ───────────── */

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
  'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos'];

const one = (g) => (g === 'm' ? 'un' : g === 'f' ? 'una' : 'uno');

function below100(n, g) {
  if (n === 1) return one(g);
  if (n === 21) return g === 'm' ? 'veintiún' : g === 'f' ? 'veintiuna' : 'veintiuno';
  if (n < 30) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (!u) return TENS[t];
  return `${TENS[t]} y ${u === 1 ? one(g) : UNITS[u]}`;
}

function below1000(n, g) {
  if (n < 100) return below100(n, g);
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const r = n % 100;
  let hs = HUNDREDS[h];
  if (g === 'f' && h >= 2) hs = hs.replace(/ientos$/, 'ientas');
  return r ? `${hs} ${below100(r, g)}` : hs;
}

/**
 * Entero en palabras. gender: null → forma para contar ('veintiuno'),
 * 'm' → ante sustantivo masculino ('veintiún minutos'), 'f' → femenino ('una serie').
 */
export function integerWords(n, gender = null) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '';
  if (v < 0) return `menos ${integerWords(-v, gender)}`;
  if (v >= 1e6) return String(v);
  if (v < 1000) return below1000(v, gender);
  const th = Math.floor(v / 1000);
  const r = v % 1000;
  const ths = th === 1 ? 'mil' : `${below1000(th, gender === 'f' ? 'f' : 'm')} mil`;
  return r ? `${ths} ${below1000(r, gender)}` : ths;
}

function decimalPartWords(frac) {
  const zeros = frac.match(/^0*/)[0].length;
  const rest = frac.slice(zeros);
  const words = Array(zeros).fill('cero');
  if (rest) words.push(integerWords(Number(rest)));
  return words.join(' ');
}

/** 11.5 → 'once coma cinco' · 13 → 'trece' · 4.05 (2 decimales) → 'cuatro coma cero cinco'. */
export function numberWords(n, decimals = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const d = Math.max(0, Math.min(3, Math.round(decimals)));
  const [ip, dp = ''] = Math.abs(v).toFixed(d).split('.');
  let out = integerWords(Number(ip));
  const frac = dp.replace(/0+$/, '');
  if (frac) out += ` coma ${decimalPartWords(frac)}`;
  return v < 0 && out !== 'cero' ? `menos ${out}` : out;
}

const minutesWords = (m) => (m === 1 ? 'un minuto' : `${integerWords(m, 'm')} minutos`);
const secondsWords = (s) => (s === 1 ? 'un segundo' : `${integerWords(s, 'm')} segundos`);
const hoursWords = (h) => (h === 1 ? 'una hora' : `${integerWords(h, 'f')} horas`);

/** Descompone segundos como los lee durationWords: { h, m, s } (con horas se omiten los segundos). */
function splitDuration(sec) {
  let t = Math.max(0, Math.round(Number(sec) || 0));
  if (t >= 3600) {
    let h = Math.floor(t / 3600);
    let m = Math.round((t - h * 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    return { h, m, s: 0 };
  }
  return { h: 0, m: Math.floor(t / 60), s: t % 60 };
}

/** 90 → 'un minuto y treinta segundos' · 60 → 'un minuto' · 3900 → 'una hora y cinco minutos'. */
export function durationWords(sec) {
  const { h, m, s } = splitDuration(sec);
  if (h) return m ? `${hoursWords(h)} y ${minutesWords(m)}` : hoursWords(h);
  if (!m) return s ? secondsWords(s) : 'cero segundos';
  return s ? `${minutesWords(m)} y ${secondsWords(s)}` : minutesWords(m);
}

const MASC_RE = /^(minutos?|segundos?|kil[oó]metros?|metros?|escal[oó]n|escalones|grados?|pasos?|d[ií]as?|años?|bloques?|tramos?|sprints?|puntos?|kilos?|minutitos?)$/i;
const FEM_RE = /^(series?|horas?|vueltas?|repetici[oó]n|repeticiones|semanas?|sesi[oó]n|sesiones|clases?|zancadas?|kilocalor[ií]as?|calor[ií]as?|pulsaciones|veces|rectas?|cuestas?|subidas?)$/i;

/** Género del sustantivo que sigue a un número: 'm' | 'f' | null. */
export function nounGender(word) {
  const w = String(word || '').replace(/[^\p{L}]/gu, '');
  if (!w) return null;
  if (MASC_RE.test(w)) return 'm';
  if (FEM_RE.test(w)) return 'f';
  return null;
}

/* ───────────── Relleno de plantillas ───────────── */

const PH_RE = /\{(\w+)\}/g;

/** Número tolerante: acepta 11.5, '11,5', '11.5'. */
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

/** 11.5 → '11,5' · 13.0 → '13'. */
function fmtNum(v, maxDec = 1) {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  const f = 10 ** maxDec;
  const r = Math.round(n * f) / f;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(maxDec).replace(/0+$/, '').replace('.', ',');
}

/** Segundos por km a partir de 'm:ss', segundos o km/h (< 40 se interpreta como km/h). */
function paceSec(v) {
  if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim())) {
    const [m, s] = v.trim().split(':').map(Number);
    return m * 60 + s;
  }
  const n = toNumber(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n < 40 ? 3600 / n : n);
}

function zoneName(v) {
  return ZONES[v]?.name ?? String(v ?? '');
}

function durationValue(v) {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : NaN;
}

function renderVar(key, vars) {
  const v = vars?.[key];
  if (v == null || v === '') return '';
  switch (key) {
    case 'speed': case 'incline': case 'vam': case 'km': return fmtNum(v, 1);
    case 'i': case 'n': case 'stage': case 'min': {
      const n = toNumber(v);
      return Number.isFinite(n) ? String(Math.round(n)) : String(v);
    }
    case 'dur': case 'lead': {
      const n = durationValue(v);
      return Number.isFinite(n) ? durationWords(n) : String(v);
    }
    case 'pace': {
      const s = paceSec(v);
      return Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(v);
    }
    case 'zone': return zoneName(v);
    default: return String(v);
  }
}

function tidy(s) {
  let out = s.replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[.!?])/g, '')
    .replace(/,{2,}/g, ',')
    .replace(/\.{2,}/g, '.')
    .trim();
  out = out.replace(/(^|[^\d,])1 (kilómetro|minuto|segundo)s\b/g, (m, a, w) => `${a}1 ${w}`);
  // Mayúscula al empezar cada frase (tras . ! ? o al inicio, admitiendo ¡ ¿)
  out = out.replace(/(^|[.!?]\s+)([¡¿"«]?)(\p{Ll})/gu, (m, a, b, c) => a + b + c.toUpperCase());
  return out;
}

/** Sustituye los marcadores con formato es-ES y arregla espacios, puntuación y mayúsculas. */
export function fill(template, vars = {}) {
  return tidy(String(template ?? '').replace(PH_RE, (m, key) => renderVar(key, vars)));
}

/** Marcadores presentes en una plantilla. */
export function placeholdersOf(template) {
  return [...String(template ?? '').matchAll(PH_RE)].map((m) => m[1]);
}

const hasVar = (vars, k) => vars != null && vars[k] != null && vars[k] !== '' && !(typeof vars[k] === 'number' && !Number.isFinite(vars[k]));

/* ───────────── Elección de frases ───────────── */

const DEFAULT_MEMORY = new Map();

function rngFn(rng) {
  if (typeof rng === 'function') return rng;
  if (rng && typeof rng.next === 'function') return () => rng.next();
  return Math.random;
}

/**
 * Elige una frase de la categoría cuyos marcadores estén todos en `vars`, evitando las 3 últimas usadas.
 * opts.require: marcadores que la frase DEBE contener · opts.memory: Map propio (determinismo por sesión).
 * Devuelve { id, text, template, category } (id '' si la categoría no existe).
 */
export function pick(category, rng = null, vars = {}, { require = [], memory = DEFAULT_MEMORY } = {}) {
  const list = PHRASES[category];
  const empty = { id: '', text: '', template: '', category };
  if (!Array.isArray(list) || !list.length) return empty;
  const ok = (t, req) => {
    const keys = placeholdersOf(t);
    return keys.every((k) => hasVar(vars, k)) && req.every((k) => keys.includes(k));
  };
  let idx = list.map((_, i) => i).filter((i) => ok(list[i], require));
  if (!idx.length && require.length) idx = list.map((_, i) => i).filter((i) => ok(list[i], []));
  if (!idx.length) return empty;
  const recent = memory.get(category) || [];
  let pool = idx.filter((i) => !recent.includes(i));
  if (!pool.length) {
    // todas recientes: la menos reciente
    pool = [idx.slice().sort((a, b) => recent.indexOf(a) - recent.indexOf(b))[0]];
  }
  const next = rngFn(rng);
  const i = pool[Math.min(pool.length - 1, Math.floor(next() * pool.length))];
  memory.set(category, [...recent.filter((x) => x !== i), i].slice(-3));
  const template = list[i];
  return { id: `${category}.${i}`, text: fill(template, vars), template, category };
}

/** La frase más corta de la categoría con los marcadores disponibles (para avisos con poco hueco). */
export function pickShortest(category, vars = {}, { require = [] } = {}) {
  const list = PHRASES[category];
  let best = null;
  (Array.isArray(list) ? list : []).forEach((t, i) => {
    const keys = placeholdersOf(t);
    if (!keys.every((k) => hasVar(vars, k)) || !require.every((k) => keys.includes(k))) return;
    const text = fill(t, vars);
    if (!best || text.length < best.text.length) best = { id: `${category}.${i}`, text, template: t, category };
  });
  return best || { id: '', text: '', template: '', category };
}

/* ───────────── Fragmentos y clips (packs de voz) ───────────── */

function cleanFragment(t) {
  let s = String(t).normalize('NFC').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[,.;:]+\s*/, '');
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}

/** 'Sube a {speed} kilómetros por hora' → ['Sube a', '{speed}', 'kilómetros por hora']. */
export function fragmentsOf(template) {
  const src = String(template ?? '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(PH_RE)) {
    const t = cleanFragment(src.slice(last, m.index));
    if (t) out.push(t);
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  const tail = cleanFragment(src.slice(last));
  if (tail) out.push(tail);
  return out;
}

const isPlaceholder = (f) => /^\{\w+\}$/.test(f);
const normClip = (t) => String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** Id estable de un clip de texto libre (fragmentos, zonas, títulos, nombre). */
export function textClipId(text) {
  return `t_${hashStr(normClip(text).toLowerCase()).toString(36)}`;
}

export const NUM_MAX = 200;      // n_0 … n_200
export const DEC_MAX = 309;      // d_1 … d_309 (0,1 … 30,9 sin enteros)

function intClipId(n, gender) {
  if (!Number.isInteger(n) || n < 0 || n > NUM_MAX) return null;
  if (gender === 'm' && integerWords(n, 'm') !== integerWords(n)) return `nm_${n}`;
  if (gender === 'f' && integerWords(n, 'f') !== integerWords(n)) return `nf_${n}`;
  return `n_${n}`;
}

function numClipId(v, gender) {
  const n = toNumber(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const r = Math.round(n * 10) / 10;
  if (Number.isInteger(r)) return intClipId(r, gender);
  const k = Math.round(r * 10);
  return k >= 1 && k <= DEC_MAX ? `d_${k}` : null;
}

/** Ids de los clips de una duración, en el mismo orden que durationWords. */
export function durationClipIds(sec) {
  const { h, m, s } = splitDuration(sec);
  if (h) return h <= 5 ? (m ? [`dh_${h}`, 'w_y', `dm_${m}`] : [`dh_${h}`]) : null;
  if (!m) return [`ds_${s}`];
  return s ? [`dm_${m}`, 'w_y', `ds_${s}`] : [`dm_${m}`];
}

function varClipIds(key, vars, nextFragment) {
  const v = vars?.[key];
  if (v == null || v === '') return null;
  const nextWord = String(nextFragment || '').split(' ')[0];
  const g = isPlaceholder(nextFragment || '') ? null : nounGender(nextWord);
  const pluralNoun = g && /s$/i.test(nextWord.replace(/[^\p{L}]/gu, ''));
  const one = (id) => (id ? [id] : null);
  switch (key) {
    case 'speed': case 'incline': case 'vam': case 'km': {
      const n = Math.round(toNumber(v) * 10) / 10;
      if (n === 1 && pluralNoun) return null; // el texto se singulariza; el clip no
      return one(numClipId(n, g));
    }
    case 'i': case 'n': case 'stage': case 'min': {
      const n = Math.round(toNumber(v));
      if (n === 1 && pluralNoun) return null;
      return one(intClipId(n, g));
    }
    case 'dur': case 'lead': {
      const n = durationValue(v);
      return Number.isFinite(n) ? durationClipIds(n) : null;
    }
    case 'pace': {
      const s = paceSec(v);
      return Number.isFinite(s) ? durationClipIds(s) : null;
    }
    case 'zone': case 'title': case 'name': {
      const text = renderVar(key, vars);
      return text ? [textClipId(text)] : null;
    }
    default: return null;
  }
}

/**
 * Ids de clips para reproducir una frase con un pack de voz, o null si algún trozo no se puede
 * representar con clips (entonces se usa la voz del sistema). phraseId se acepta por contrato.
 */
export function clipIdsFor(phraseId, template, vars = {}) {
  const frags = fragmentsOf(template);
  if (!frags.length) return null;
  const out = [];
  for (let k = 0; k < frags.length; k++) {
    const f = frags[k];
    const m = /^\{(\w+)\}$/.exec(f);
    if (!m) { out.push(textClipId(f)); continue; }
    const ids = varClipIds(m[1], vars, frags[k + 1]);
    if (!ids) return null;
    out.push(...ids);
  }
  return out;
}

/** Clips fijos: números, decimales, duraciones, conectores, zonas y unidades. */
export function baseClips() {
  const clips = [];
  for (let n = 0; n <= NUM_MAX; n++) {
    clips.push({ id: `n_${n}`, text: integerWords(n) });
    if (integerWords(n, 'm') !== integerWords(n)) clips.push({ id: `nm_${n}`, text: integerWords(n, 'm') });
    if (integerWords(n, 'f') !== integerWords(n)) clips.push({ id: `nf_${n}`, text: integerWords(n, 'f') });
  }
  for (let k = 1; k <= DEC_MAX; k++) if (k % 10) clips.push({ id: `d_${k}`, text: numberWords(k / 10) });
  for (let h = 1; h <= 5; h++) clips.push({ id: `dh_${h}`, text: hoursWords(h) });
  for (let m = 1; m <= 59; m++) clips.push({ id: `dm_${m}`, text: minutesWords(m) });
  clips.push({ id: 'ds_0', text: 'cero segundos' });
  for (let s = 1; s <= 59; s++) clips.push({ id: `ds_${s}`, text: secondsWords(s) });
  clips.push({ id: 'w_y', text: 'y' });
  for (const z of Object.values(ZONES)) clips.push({ id: textClipId(z.name), text: z.name });
  for (const u of ['kilómetros por hora', 'kilómetros', 'kilómetro', 'por ciento', 'minutos', 'segundos']) {
    clips.push({ id: textClipId(u), text: u });
  }
  return clips;
}

/**
 * Lista completa de clips del manifiesto (fragmentos estáticos de todas las frases + clips fijos
 * + títulos/textos extra). Lanza un error si dos textos distintos colisionan en el mismo id.
 */
export function manifestClips({ titles = [], extras = [] } = {}) {
  const map = new Map();
  const add = (id, text) => {
    const t = normClip(text);
    if (!t) return;
    const prev = map.get(id);
    if (prev != null) {
      if (prev.toLowerCase() !== t.toLowerCase()) throw new Error(`Colisión de id ${id}: «${prev}» / «${t}»`);
      return;
    }
    map.set(id, t);
  };
  for (const list of Object.values(PHRASES)) {
    for (const tpl of list) for (const f of fragmentsOf(tpl)) if (!isPlaceholder(f)) add(textClipId(f), f);
  }
  for (const c of baseClips()) add(c.id, c.text);
  for (const t of [...titles, ...extras]) if (t) add(textClipId(t), t);
  return [...map].map(([id, text]) => ({ id, text }));
}
