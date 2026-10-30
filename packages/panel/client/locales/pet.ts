import type { Catalog } from "../i18n.js";
const keys = [
    "Connection interrupted · showing last snapshot",
    "Waiting for a snapshot",
    "Recorded demo · no live agents",
    "Snapshot needs attention",
    "Your input is needed",
    "Run stopped",
    "Run paused",
    "Work needs attention",
    "Production activity recorded",
    "Verification activity recorded",
    "Combined verification passed",
    "Combined verification failed",
    "Run complete · combined checks not recorded",
    "Run complete · global gates not configured",
    "Ready when you are",
    "Clockwork companion",
    "Companion controls",
    "Close companion",
    "{accepted} of {total} units accepted",
    "{workers} builders · {verifiers} verifiers",
    "Inspect task {id}",
    "Open decisions",
    "Creature",
    "Brass moth",
    "Mint rover",
    "Violet scout",
    "Announce status changes",
    "Show creature",
    "Hide creature",
    "Restore companion",
    "Open companion"
];
const entries = {
    tr: [
        "Bağlantı kesildi · son görüntü gösteriliyor",
        "Veri bekleniyor",
        "Kayıtlı demo · canlı ajan yok",
        "Veriler ilgi gerektiriyor",
        "Yanıtınız gerekiyor",
        "Çalışma durduruldu",
        "Çalışma duraklatıldı",
        "İş ilgi gerektiriyor",
        "Üretim etkinliği kaydedildi",
        "Doğrulama etkinliği kaydedildi",
        "Birleşik doğrulama geçti",
        "Birleşik doğrulama başarısız",
        "Çalışma tamamlandı · birleşik kontroller kaydedilmedi",
        "Çalışma tamamlandı · genel kontroller yapılandırılmadı",
        "Hazır olduğunda buradayım",
        "Clockwork yoldaşı",
        "Yoldaş kontrolleri",
        "Yoldaşı kapat",
        "{total} birimin {accepted} tanesi kabul edildi",
        "{workers} üretici · {verifiers} doğrulayıcı",
        "{id} görevini incele",
        "Kararları aç",
        "Karakter",
        "Pirinç Kanat",
        "Nane Gezgini",
        "Mor Kaşif",
        "Durum değişikliklerini duyur",
        "Karakteri göster",
        "Karakteri gizle",
        "Yoldaşı geri getir",
        "Yoldaşı aç"
    ],
    es: [
        "Conexión interrumpida · última captura",
        "Esperando datos",
        "Demo grabada · sin agentes en vivo",
        "Los datos requieren atención",
        "Se necesita tu respuesta",
        "Ejecución detenida",
        "Ejecución pausada",
        "El trabajo requiere atención",
        "Actividad de producción registrada",
        "Actividad de verificación registrada",
        "Verificación conjunta aprobada",
        "Verificación conjunta fallida",
        "Ejecución completa · sin controles conjuntos registrados",
        "Ejecución completa · controles globales sin configurar",
        "Aquí cuando quieras",
        "Compañero Clockwork",
        "Controles del compañero",
        "Cerrar compañero",
        "{accepted} de {total} unidades aceptadas",
        "{workers} constructores · {verifiers} verificadores",
        "Inspeccionar tarea {id}",
        "Abrir decisiones",
        "Criatura",
        "Polilla de latón",
        "Explorador menta",
        "Vigía violeta",
        "Anunciar cambios de estado",
        "Mostrar criatura",
        "Ocultar criatura",
        "Restaurar compañero",
        "Abrir compañero"
    ],
    de: [
        "Verbindung unterbrochen · letzter Datenstand",
        "Warte auf Daten",
        "Aufgezeichnete Demo · keine Live-Agenten",
        "Daten benötigen Aufmerksamkeit",
        "Deine Eingabe ist erforderlich",
        "Lauf gestoppt",
        "Lauf pausiert",
        "Arbeit benötigt Aufmerksamkeit",
        "Produktionsaktivität aufgezeichnet",
        "Prüfaktivität aufgezeichnet",
        "Gesamtprüfung bestanden",
        "Gesamtprüfung fehlgeschlagen",
        "Lauf abgeschlossen · keine Gesamtprüfung aufgezeichnet",
        "Lauf abgeschlossen · globale Prüfungen nicht konfiguriert",
        "Bereit, wenn du es bist",
        "Clockwork-Begleiter",
        "Begleiter-Steuerung",
        "Begleiter schließen",
        "{accepted} von {total} Einheiten akzeptiert",
        "{workers} Ersteller · {verifiers} Prüfer",
        "Aufgabe {id} ansehen",
        "Entscheidungen öffnen",
        "Wesen",
        "Messingmotte",
        "Minzrover",
        "Violetter Späher",
        "Statusänderungen ansagen",
        "Wesen anzeigen",
        "Wesen ausblenden",
        "Begleiter wiederherstellen",
        "Begleiter öffnen"
    ],
    fr: [
        "Connexion interrompue · dernier état affiché",
        "En attente de données",
        "Démo enregistrée · aucun agent en direct",
        "Les données demandent une attention",
        "Votre réponse est nécessaire",
        "Exécution arrêtée",
        "Exécution en pause",
        "Le travail demande une attention",
        "Activité de production enregistrée",
        "Activité de vérification enregistrée",
        "Vérification combinée réussie",
        "Vérification combinée échouée",
        "Exécution terminée · contrôles combinés non enregistrés",
        "Exécution terminée · contrôles globaux non configurés",
        "Prêt quand vous voulez",
        "Compagnon Clockwork",
        "Commandes du compagnon",
        "Fermer le compagnon",
        "{accepted} unités acceptées sur {total}",
        "{workers} créateurs · {verifiers} vérificateurs",
        "Inspecter la tâche {id}",
        "Ouvrir les décisions",
        "Créature",
        "Papillon de laiton",
        "Rover menthe",
        "Éclaireur violet",
        "Annoncer les changements d’état",
        "Afficher la créature",
        "Masquer la créature",
        "Rétablir le compagnon",
        "Ouvrir le compagnon"
    ],
    pt: [
        "Conexão interrompida · último estado exibido",
        "Aguardando dados",
        "Demo gravada · sem agentes ao vivo",
        "Os dados precisam de atenção",
        "Sua resposta é necessária",
        "Execução interrompida",
        "Execução pausada",
        "O trabalho precisa de atenção",
        "Atividade de produção registrada",
        "Atividade de verificação registrada",
        "Verificação conjunta aprovada",
        "Verificação conjunta falhou",
        "Execução concluída · verificações conjuntas não registradas",
        "Execução concluída · verificações globais não configuradas",
        "Pronto quando você estiver",
        "Companheiro Clockwork",
        "Controles do companheiro",
        "Fechar companheiro",
        "{accepted} de {total} unidades aceitas",
        "{workers} construtores · {verifiers} verificadores",
        "Inspecionar tarefa {id}",
        "Abrir decisões",
        "Criatura",
        "Mariposa de latão",
        "Explorador menta",
        "Batedor violeta",
        "Anunciar mudanças de estado",
        "Mostrar criatura",
        "Ocultar criatura",
        "Restaurar companheiro",
        "Abrir companheiro"
    ]
};
export const petMessages = Object.fromEntries(Object.entries(entries).map(([locale, values]) => [
    locale, Object.fromEntries(keys.map((key, index) => [
        key, values[index]!
    ]))
])) as Catalog;
const navigationMessages = {
    tr: [
        "Ekibi görüntüle", "Bildirimi kapat"
    ],
    es: [
        "Ver equipo", "Descartar actualización"
    ],
    de: [
        "Team ansehen", "Meldung schließen"
    ],
    fr: [
        "Voir l’équipe", "Fermer la mise à jour"
    ],
    pt: [
        "Ver equipe", "Dispensar atualização"
    ]
};
for (const locale of Object.keys(navigationMessages) as (keyof typeof navigationMessages)[]) {
    petMessages[locale]["View team"] = navigationMessages[locale][0]!;
    petMessages[locale]["Dismiss update"] = navigationMessages[locale][1]!;
}
const requestMessages = {
  tr: ["Durdurma istendi · etkinlik sürebilir", "Duraklatma istendi · etkinlik sürebilir"],
  es: ["Parada solicitada · la actividad puede continuar", "Pausa solicitada · la actividad puede continuar"],
  de: ["Stopp angefordert · Aktivität kann weiterlaufen", "Pause angefordert · Aktivität kann weiterlaufen"],
  fr: ["Arrêt demandé · l’activité peut continuer", "Pause demandée · l’activité peut continuer"],
  pt: ["Parada solicitada · a atividade pode continuar", "Pausa solicitada · a atividade pode continuar"],
};
for (const locale of Object.keys(requestMessages) as (keyof typeof requestMessages)[]) {
  petMessages[locale]["Stop requested · activity may continue"] = requestMessages[locale][0]!;
  petMessages[locale]["Pause requested · activity may continue"] = requestMessages[locale][1]!;
}

const animalMessages = {
  tr: ["Kara · Baykuş", "Moss · Kaplumbağa", "Nova · Tilki", "Piko · Deniz papağanı"],
  es: ["Kara · Búho", "Moss · Tortuga", "Nova · Zorro", "Piko · Frailecillo"],
  de: ["Kara · Eule", "Moss · Schildkröte", "Nova · Fuchs", "Piko · Papageitaucher"],
  fr: ["Kara · Hibou", "Moss · Tortue", "Nova · Renard", "Piko · Macareux"],
  pt: ["Kara · Coruja", "Moss · Tartaruga", "Nova · Raposa", "Piko · Papagaio-do-mar"],
};
for (const locale of Object.keys(animalMessages) as (keyof typeof animalMessages)[]) {
  ["Kara · Owl", "Moss · Turtle", "Nova · Fox", "Piko · Puffin"].forEach((key, index) => {
    petMessages[locale][key] = animalMessages[locale][index]!;
  });
}

const placementMessages = {
  tr: ["Yoldaşı taşı", "Taşımak için sürükleyin; ok tuşları 16 piksel taşır.", "Yoldaşı sabitle", "Yoldaşı serbest bırak", "Yoldaş konumunu sıfırla"],
  es: ["Mover compañero", "Arrastra para mover; las flechas desplazan 16 píxeles.", "Acoplar compañero", "Desacoplar compañero", "Restablecer posición del compañero"],
  de: ["Begleiter verschieben", "Zum Verschieben ziehen; Pfeiltasten bewegen um 16 Pixel.", "Begleiter andocken", "Begleiter lösen", "Begleiterposition zurücksetzen"],
  fr: ["Déplacer le compagnon", "Faites glisser pour déplacer ; les flèches déplacent de 16 pixels.", "Ancrer le compagnon", "Détacher le compagnon", "Réinitialiser la position du compagnon"],
  pt: ["Mover companheiro", "Arraste para mover; as setas movem 16 pixels.", "Ancorar companheiro", "Desancorar companheiro", "Redefinir posição do companheiro"],
};
for (const locale of Object.keys(placementMessages) as (keyof typeof placementMessages)[]) {
  ["Move companion", "Drag to move; arrow keys move by 16 pixels.", "Dock companion", "Float companion", "Reset companion position"].forEach((key, index) => {
    petMessages[locale][key] = placementMessages[locale][index]!;
  });
}
