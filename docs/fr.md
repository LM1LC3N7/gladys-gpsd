# gpsd

Affiche dans Gladys la position d'un récepteur GPS / GNSS partagé par
[gpsd](https://gpsd.io) : camping-car, bateau, cabane, mât météo. gpsd lit le
récepteur (USB ou série) sur sa propre machine et partage ses rapports sur le
réseau ; cette intégration s'y connecte en TCP et les lit. Elle ne touche ni à
l'USB ni à un port série, et n'envoie jamais rien au récepteur.

> Cette intégration n'a jamais été testée avec un vrai récepteur : elle a été
> testée avec gpsd 3.25 et `gpsfake` rejouant un journal NMEA. Vos retours sont
> les bienvenus.

## Ce que vous obtenez

Un appareil par adresse de gpsd (onglet Découverte), en lecture seule :

| Fonction            | Unité / valeurs                                            |
| ------------------- | ---------------------------------------------------------- |
| Latitude            | degrés, arrondie (voir Précision)                          |
| Longitude           | degrés, arrondie (voir Précision)                          |
| Vitesse             | km/h, au dixième                                           |
| Altitude            | mètres au-dessus du niveau de la mer, fix 3D seulement     |
| Cap                 | degrés depuis le nord vrai, au-dessus de 2 km/h            |
| Mode du fix         | 1 pas de fix, 2 2D, 3 3D                                   |
| Fix                 | texte : `no fix`, `2D`, `3D`, `3D DGPS`, `3D RTK fixed`... |
| Erreur horizontale  | mètres, estimée par gpsd                                   |
| Satellites utilisés | nombre                                                     |
| Satellites vus      | nombre                                                     |

Une valeur que gpsd ne donne pas reste inconnue (jamais 0). Sans fix, seuls le
mode et le texte du fix sont publiés, jamais une position : Gladys continue
d'afficher les dernières position, vitesse, altitude et cap reçues, avec leur
date (une intégration ne peut pas effacer une valeur). Sous 2 km/h, le cap n'est
pas mis à jour. gpsd envoie plusieurs rapports par seconde, certains sans le cap
ni la vitesse : une valeur absente du plus récent est reprise d'un rapport du
même fix vieux de 3 secondes au plus.

## Avant de commencer

- gpsd doit écouter sur le réseau : lancez-le avec `-G` (sur Debian,
  `GPSD_OPTIONS="-G"` dans `/etc/default/gpsd`). Un gpsd activé par socket
  demande aussi `sudo systemctl edit gpsd.socket` avec les lignes ci-dessous
  (la ligne `ListenStream=` vide efface d'abord les adresses locales), puis
  `sudo systemctl restart gpsd.socket gpsd` :

  ```ini
  [Socket]
  ListenStream=
  ListenStream=/run/gpsd.sock
  ListenStream=0.0.0.0:2947
  ```

  Vérifiez avec `gpspipe -w <adresse>` depuis une autre machine.

- Le port TCP 2947 (ou le vôtre) doit être joignable depuis Gladys. gpsd n'a
  pas de mot de passe : gardez-le sur votre réseau local, ne l'ouvrez pas sur
  internet.

## Configuration

- **Adresse de gpsd** : nom ou adresse IP de la machine de gpsd, `:port` si ce
  n'est pas 2947 (IPv6 entre crochets : `[fd00::12]:2947`).
- **Récepteur** (facultatif) : seulement si gpsd lit plusieurs récepteurs, le
  chemin de celui à suivre tel que gpsd le nomme (`/dev/ttyACM0`). Vide : le
  premier qui envoie un rapport ; si gpsd le désactive, le suivant qui envoie
  un rapport est suivi. Le bouton de test liste les autres récepteurs vus ; le
  statut ne les nomme que si le récepteur choisi n'envoie rien.
- **Publication** : gpsd envoie environ un rapport par seconde ; l'intégration
  garde le plus récent et publie au plus toutes les 10 s, 30 s, 1 min (par
  défaut), 5 min ou 15 min, seulement les valeurs qui ont changé (une valeur
  inchangée est renvoyée une fois par heure). Le premier rapport est publié tout
  de suite, sauf si une publication est partie il y a moins d'un intervalle.
- **Précision de la position** : environ 1 m (5 décimales), 10 m (4, par
  défaut), 100 m (3) ou 1 km (2). L'altitude suit (0,1 m, 1 m, 10 m, 100 m).

## Vie privée

Une position est une donnée personnelle. Elle est arrondie avant d'arriver dans
Gladys, n'est écrite ni dans les journaux, ni dans le statut, ni dans la réponse
du bouton de test. Latitude, longitude, altitude, cap et texte du fix sont
gardés sans historique par défaut (ensemble, ils dessineraient vos trajets) ;
vitesse, erreur horizontale, mode du fix et satellites le gardent. Vous pouvez
le changer fonction par fonction dans Gladys.

## Statut et bouton de test

L'écran de configuration montre l'état de la connexion : connecté avec une
position, pas encore de fix, aucun récepteur actif, un récepteur choisi qui
n'envoie rien (avec les récepteurs que gpsd signale à la place), aucun rapport
depuis une minute, ou la raison d'un échec (refus,
nom inconnu, injoignable, pas gpsd, autre version du protocole, gpsd ne répond
plus). Connecté, le statut change au plus une fois toutes les 10 secondes (un fix qui
va et vient n'inonde pas Gladys). Une connexion perdue est réessayée après 5 s, puis 10, 20... jusqu'à
5 minutes. Le bouton **Tester la connexion** donne le même état avec le type de fix (2D, 3D,
DGPS...), les satellites et le rythme ; il n'ouvre jamais de nouvelle connexion.

## Fonctionnement

L'intégration lit la bannière de gpsd (`VERSION`, protocole 3), demande
`?WATCH={"enable":true,"json":true};` (rapports JSON seulement, jamais de NMEA),
et lit les objets `TPV` (position, vitesse, fix), `SKY` (satellites) et
`DEVICE(S)` (récepteurs). Une connexion muette depuis une minute reçoit
`?VERSION;` ; sans réponse sous 10 s, elle est fermée puis réessayée. Les lignes
sont bornées (16 Kio), le débit aussi (256 Kio/s).

## Identité de l'appareil

L'identifiant de l'appareil est une empreinte de l'adresse de gpsd
(`hôte:port`) : une autre adresse fait un autre appareil ; un récepteur branché
sur un autre port USB reste le même appareil.

Intégration non officielle, sans lien avec le projet GPSD.
