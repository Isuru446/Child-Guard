import 'teacher_alert_card.dart' show alertTime;

String attendanceConfirmationText(dynamic confirmation) {
  if (confirmation == null) return 'No recorded confirmation';
  if (confirmation['method'] == 'RFID_CARD') {
    return 'Confirmed by RFID card: ${alertTime(confirmation['confirmedAt'])}';
  }
  return 'Confirmed: ${confirmation['confirmedAt']} by ${confirmation['user']?['username'] ?? 'Recorded staff member'}';
}
