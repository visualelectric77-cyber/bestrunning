// RITMUP · las tres capacidades que el plan puede trabajar más. Sin dependencias: lo comparten el planificador y el
// análisis. `expected` es lo normal en cada una: una clase de series cuesta más y se clava menos que una de fondo, así
// que se compara a cada tipo con lo suyo, no a todos con la misma vara.
export const CAPACITIES = {
  velocidad: {
    name: 'Velocidad', noun: 'la velocidad', cats: ['intervals', 'hills'],
    families: ['series-cortas', 'cuestas', 'piramide', 'escalera'],
    expected: { score: 72, rpe: 8 }, slots: ['H'],
  },
  ritmo: {
    name: 'Ritmo', noun: 'el ritmo', cats: ['tempo', 'fartlek'],
    families: ['tempo', 'umbral', 'series-largas', 'fartlek'],
    expected: { score: 78, rpe: 7 }, slots: ['H', 'M'],
  },
  fondo: {
    name: 'Fondo', noun: 'el fondo', cats: ['endurance'],
    families: ['resistencia', 'progresivo'],
    expected: { score: 84, rpe: 5.5 }, slots: ['M', 'H'],
  },
};

export const FOCUS_WEEKS = 4;
