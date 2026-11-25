// -----------------------------------------------------------------------------
// The texts shown to the user (status of the Configuration screen, answer of
// the test button). Never a coordinate: the position stays in its features.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));

const REASONS = {
  refused: {
    en: 'gpsd refused the connection (not running, or listening on localhost only: start it with -G)',
    fr: 'gpsd a refusé la connexion (arrêté, ou à l’écoute de localhost seulement : lancez-le avec -G)',
  },
  unresolved: {
    en: 'the name of the gpsd machine is unknown on the network',
    fr: 'le nom de la machine de gpsd est inconnu sur le réseau',
  },
  unreachable: {
    en: 'the gpsd machine cannot be reached',
    fr: 'la machine de gpsd est injoignable',
  },
  timeout: {
    en: 'no answer from the gpsd address',
    fr: 'aucune réponse de l’adresse de gpsd',
  },
  closed: {
    en: 'gpsd closed the connection',
    fr: 'gpsd a fermé la connexion',
  },
  not_gpsd: {
    en: 'the program at this address does not speak the gpsd protocol',
    fr: 'le programme à cette adresse ne parle pas le protocole de gpsd',
  },
  protocol: {
    en: 'this gpsd speaks another version of its protocol (3 expected)',
    fr: 'ce gpsd parle une autre version de son protocole (3 attendue)',
  },
  silent: {
    en: 'gpsd stopped answering',
    fr: 'gpsd ne répond plus',
  },
  flood: {
    en: 'gpsd sent far more data than reports need: connection closed',
    fr: 'gpsd a envoyé bien plus de données que ses rapports n’en demandent : connexion fermée',
  },
  error: {
    en: 'network error',
    fr: 'erreur réseau',
  },
};

export const T = {
  addressMissing: {
    en: 'Type the address of the machine running gpsd in the configuration.',
    fr: 'Saisissez l’adresse de la machine qui fait tourner gpsd dans la configuration.',
  },
  addressInvalid: {
    en: 'The gpsd address is not valid: a name or IP address, with :port if not 2947.',
    fr: 'L’adresse de gpsd n’est pas valide : un nom ou une adresse IP, avec :port si ce n’est pas 2947.',
  },
  receiverInvalid: {
    en: 'The receiver is not valid: a path such as /dev/ttyACM0, or empty.',
    fr: 'Le récepteur n’est pas valide : un chemin comme /dev/ttyACM0, ou vide.',
  },
  configUnreadable: (ms) => ({
    en: `The configuration could not be read from Gladys; next try in ${seconds(ms)} s.`,
    fr: `La configuration n’a pas pu être lue dans Gladys ; nouvel essai dans ${seconds(ms)} s.`,
  }),
  connecting: (target) => ({
    en: `Connecting to gpsd at ${target}…`,
    fr: `Connexion à gpsd sur ${target}…`,
  }),
  failed: (reason, ms) => ({
    en: `Not connected: ${(REASONS[reason] ?? REASONS.error).en}. Next try in ${seconds(ms)} s.`,
    fr: `Non connecté : ${(REASONS[reason] ?? REASONS.error).fr}. Nouvel essai dans ${seconds(ms)} s.`,
  }),
  fix: (release, fix) => ({
    en: `Connected to gpsd ${release}: ${fix} fix.`,
    fr: `Connecté à gpsd ${release} : position ${fix}.`,
  }),
  noFix: (release) => ({
    en: `Connected to gpsd ${release}: no fix yet (does the antenna see the sky?).`,
    fr: `Connecté à gpsd ${release} : pas encore de position (l’antenne voit-elle le ciel ?).`,
  }),
  waiting: (release) => ({
    en: `Connected to gpsd ${release}: waiting for the first report of the receiver.`,
    fr: `Connecté à gpsd ${release} : en attente du premier rapport du récepteur.`,
  }),
  noReceiver: (release) => ({
    en: `Connected to gpsd ${release}, but it has no active receiver (plugged in? gpsd started with its path?).`,
    fr: `Connecté à gpsd ${release}, mais il n’a aucun récepteur actif (branché ? gpsd lancé avec son chemin ?).`,
  }),
  receiverNotSeen: (release, receiver, others) => ({
    en: `Connected to gpsd ${release}: nothing from ${receiver}; gpsd reports ${others}.`,
    fr: `Connecté à gpsd ${release} : rien de ${receiver} ; gpsd signale ${others}.`,
  }),
  silent: (release) => ({
    en: `Connected to gpsd ${release}: no report for a minute.`,
    fr: `Connecté à gpsd ${release} : aucun rapport depuis une minute.`,
  }),
  readOnly: {
    en: 'Read only: this integration never sends anything to the receiver.',
    fr: 'Lecture seule : cette intégration n’envoie jamais rien au récepteur.',
  },
  testPublishing: (sec, decimals) => ({
    en: ` Published at most every ${sec} s, coordinates rounded to ${decimals} decimals.`,
    fr: ` Publié au plus toutes les ${sec} s, coordonnées arrondies à ${decimals} décimales.`,
  }),
  testOthers: (others) => ({
    en: ` Other receivers seen: ${others}.`,
    fr: ` Autres récepteurs vus : ${others}.`,
  }),
  testSatellites: (used, seen) => ({
    en: ` Satellites: ${used ?? '?'} used, ${seen ?? '?'} seen.`,
    fr: ` Satellites : ${used ?? '?'} utilisés, ${seen ?? '?'} vus.`,
  }),
};

/** Joins multi-language texts. */
export const join = (...parts) => ({
  en: parts.map((p) => p.en).join(''),
  fr: parts.map((p) => p.fr).join(''),
});
