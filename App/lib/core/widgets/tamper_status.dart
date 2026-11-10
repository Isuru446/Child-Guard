String tamperStatusText(dynamic device, {DateTime? now}) {
  final tamper = device?['tamper'];
  final observed = DateTime.tryParse('${tamper?['observedAt']}');
  final age = observed == null
      ? null
      : (now ?? DateTime.now()).difference(observed);
  final fresh =
      tamper?['stale'] == false &&
      age != null &&
      !age.isNegative &&
      age.inMilliseconds <= 60000;
  final state = fresh ? (tamper?['state']) : 'UNKNOWN';
  final label = state == 'OPEN'
      ? 'Disconnected'
      : state == 'CLOSED'
      ? 'Connected'
      : 'Unavailable';
  final last = tamper?['lastKnownState'];
  final suffix = !fresh && ['OPEN', 'CLOSED'].contains(last)
      ? ' (last known: ${last == 'OPEN' ? 'Disconnected' : 'Connected'})'
      : '';
  return 'Tamper loop: $label$suffix';
}
