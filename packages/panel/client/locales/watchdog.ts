import type { Catalog } from "../i18n.js";

const rows: Record<string, [string, string, string, string, string]> = {
  "Execution monitoring": ["Çalıştırma takibi", "Supervisión de ejecuciones", "Ausführungsüberwachung", "Suivi des exécutions", "Monitoramento de execuções"],
  "Execution monitoring is unavailable for this run.": ["Bu çalışma için çalıştırma takibi mevcut değil.", "La supervisión de ejecuciones no está disponible para esta sesión.", "Für diesen Lauf ist keine Ausführungsüberwachung verfügbar.", "Le suivi des exécutions est indisponible pour cette session.", "O monitoramento de execuções não está disponível nesta sessão."],
  "Recorded execution history": ["Kaydedilmiş çalıştırma geçmişi", "Historial de ejecuciones registrado", "Aufgezeichneter Ausführungsverlauf", "Historique des exécutions enregistré", "Histórico de execuções registrado"],
  "Live ledger updates": ["Canlı kayıt güncellemeleri", "Actualizaciones del registro en directo", "Live-Aktualisierungen des Protokolls", "Mises à jour du journal en direct", "Atualizações do registro ao vivo"],
  "Updates unavailable · showing last snapshot": ["Güncellemeler alınamıyor · son kayıt gösteriliyor", "Actualizaciones no disponibles · se muestra la última captura", "Keine Aktualisierungen · letzter Stand wird angezeigt", "Mises à jour indisponibles · dernier état affiché", "Atualizações indisponíveis · exibindo o último estado"],
  "Execution records show agent activity. Panel connectivity does not measure process liveness.": ["Çalıştırma kayıtları ajan etkinliğini gösterir. Panel bağlantısı sürecin çalıştığını ölçmez.", "Los registros muestran la actividad del agente. La conexión del panel no mide si el proceso sigue activo.", "Ausführungsprotokolle zeigen Agentenaktivität. Die Panel-Verbindung misst nicht, ob ein Prozess läuft.", "Les journaux indiquent l’activité des agents. La connexion du panneau ne mesure pas si le processus est actif.", "Os registros mostram a atividade dos agentes. A conexão do painel não mede se o processo está ativo."],
  "Execution failed": ["Çalıştırma başarısız", "Ejecución fallida", "Ausführung fehlgeschlagen", "Échec de l’exécution", "Falha na execução"],
  "Execution completed": ["Çalıştırma tamamlandı", "Ejecución completada", "Ausführung abgeschlossen", "Exécution terminée", "Execução concluída"],
  "Execution running": ["Çalıştırma sürüyor", "Ejecución en curso", "Ausführung läuft", "Exécution en cours", "Execução em andamento"],
  "Termination unconfirmed": ["Sürecin sonlandığı doğrulanmadı", "Terminación no confirmada", "Prozessende unbestätigt", "Arrêt du processus non confirmé", "Encerramento não confirmado"],
  "Idle warning recorded": ["Etkinlik yok uyarısı kaydedildi", "Advertencia de inactividad registrada", "Inaktivitätswarnung aufgezeichnet", "Avertissement d’inactivité enregistré", "Aviso de inatividade registrado"],
  "Expected duration exceeded": ["Beklenen süre aşıldı", "Duración prevista superada", "Erwartete Dauer überschritten", "Durée prévue dépassée", "Duração prevista excedida"],
  "Execution timeout recorded": ["Çalıştırma zaman aşımı kaydedildi", "Tiempo de ejecución agotado registrado", "Ausführungszeitüberschreitung aufgezeichnet", "Délai d’exécution dépassé enregistré", "Tempo limite da execução registrado"],
  "Delivery reconciliation timeout recorded": ["Teslimat işleme zaman aşımı kaydedildi", "Tiempo de conciliación de entrega agotado registrado", "Zeitüberschreitung der Lieferungsabstimmung aufgezeichnet", "Délai de traitement de la livraison dépassé enregistré", "Tempo limite da conciliação da entrega registrado"],
  "Last agent activity": ["Son ajan etkinliği", "Última actividad del agente", "Letzte Agentenaktivität", "Dernière activité de l’agent", "Última atividade do agente"],
  "Last execution heartbeat": ["Son çalıştırma yaşam sinyali", "Última señal de ejecución", "Letztes Ausführungs-Lebenszeichen", "Dernier signal d’exécution", "Último sinal de execução"],
  "Delivery acknowledged": ["Teslimat işlendi", "Entrega procesada", "Lieferung verarbeitet", "Livraison traitée", "Entrega processada"],
  "Delivery received · awaiting acknowledgement": ["Teslimat alındı · işlenmeyi bekliyor", "Entrega recibida · pendiente de procesamiento", "Lieferung empfangen · Verarbeitung ausstehend", "Livraison reçue · traitement en attente", "Entrega recebida · aguardando processamento"],
  "Received": ["Alındı", "Recibida", "Empfangen", "Reçue", "Recebida"],
  "Acknowledged": ["İşlendi", "Procesada", "Verarbeitet", "Traitée", "Processada"],
  "Acknowledgement records processing, not task acceptance.": ["İşleme kaydı, görevin kabul edildiği anlamına gelmez.", "El registro de procesamiento no significa que la tarea esté aceptada.", "Die Verarbeitungsbestätigung bedeutet keine Aufgabenabnahme.", "La confirmation du traitement ne signifie pas que la tâche est acceptée.", "A confirmação do processamento não significa que a tarefa foi aceita."],
  "No delivery recorded": ["Teslimat kaydı yok", "Sin entrega registrada", "Keine Lieferung aufgezeichnet", "Aucune livraison enregistrée", "Nenhuma entrega registrada"],
  "Monitoring details": ["Takip ayrıntıları", "Detalles de supervisión", "Überwachungsdetails", "Détails du suivi", "Detalhes do monitoramento"],
  "Started": ["Başladı", "Inicio", "Gestartet", "Début", "Início"],
  "Idle warning after": ["Etkinlik yok uyarısı eşiği", "Umbral de inactividad", "Inaktivitätswarnung nach", "Seuil d’inactivité", "Limite para aviso de inatividade"],
  "{seconds} seconds": ["{seconds} saniye", "{seconds} segundos", "{seconds} Sekunden", "{seconds} secondes", "{seconds} segundos"],
  "Expected duration": ["Beklenen süre", "Duración prevista", "Erwartete Dauer", "Durée prévue", "Duração prevista"],
  "Execution limit": ["Çalıştırma süresi sınırı", "Límite de ejecución", "Ausführungslimit", "Limite d’exécution", "Limite de execução"],
  "Reconciliation limit": ["Teslimat işleme süresi sınırı", "Límite de conciliación", "Abstimmungslimit", "Limite de traitement", "Limite de conciliação"],
  "Delivery ID": ["Teslimat kimliği", "ID de entrega", "Lieferungs-ID", "Identifiant de livraison", "ID da entrega"],
  "Recorded delivery outcome": ["Kaydedilen teslimat sonucu", "Resultado de entrega registrado", "Aufgezeichnetes Lieferungsergebnis", "Résultat de livraison enregistré", "Resultado da entrega registrado"],
};
export const watchdogMessages: Catalog = { tr: {}, es: {}, de: {}, fr: {}, pt: {} };
(["tr", "es", "de", "fr", "pt"] as const).forEach((locale, index) => {
  for (const [key, values] of Object.entries(rows)) watchdogMessages[locale][key] = values[index]!;
});
