/// Parent-facing presentation of the existing server analysis. This never
/// creates alerts or changes the server's eligibility or sustained-low rules.
class ParentActivitySummary {
  final Map<String, dynamic> data;
  ParentActivitySummary(this.data);

  static double? number(dynamic value) =>
      value is num && value.isFinite ? value.toDouble() : null;

  String get state => data['state']?.toString() ?? '';
  bool get comparable => const {
    'NORMAL',
    'BELOW_BASELINE_CANDIDATE',
    'LOW_ACTIVITY',
    'LOW_ACTIVITY_ADVISORY',
  }.contains(state);
  bool get learning => state == 'BASELINE_LEARNING';
  String get kind => switch (state) {
    'NORMAL' => 'normal',
    'BELOW_BASELINE_CANDIDATE' => 'slightlyLow',
    'LOW_ACTIVITY' || 'LOW_ACTIVITY_ADVISORY' => 'low',
    _ => 'unknown',
  };
  String get label => switch (kind) {
    'normal' => 'Activity looks normal',
    'slightlyLow' => 'Activity is slightly lower than usual',
    'low' => 'Low activity detected',
    _ =>
      state == 'SENSOR_UNAVAILABLE'
          ? 'No recent wearable activity data'
          : 'Not enough data yet',
  };
  String get message => switch (kind) {
    'normal' => 'Recent movement is close to the usual pattern.',
    'slightlyLow' => 'Movement in the latest period is lower than usual. We are watching for a continuing change.',
    'low' => 'Recent movement is much lower than the child\'s usual level. Check whether your child is resting or wearing the device correctly.',
    _ =>
      learning
          ? 'We are still learning the normal activity pattern.'
          : state == 'NOT_MONITORING'
          ? 'Activity comparison is paused outside monitored school time or when attendance is not confirmed.'
          : state == 'SENSOR_UNAVAILABLE'
          ? 'No recent wearable activity data available. Check that the wearable is connected and being worn.'
          : 'We need more complete readings before comparing activity.',
  };
  double? get relativeToday {
    final current = number(data['currentScoreMg']);
    final baseline = number(data['baselineScoreMg']);
    return comparable && current != null && baseline != null && baseline > 0
        ? current / baseline * 100
        : null;
  }

  String get trend {
    final value = relativeToday;
    if (value == null) return 'Comparison not available yet';
    final change = value - 100;
    if (change.abs() < 0.5) return 'Close to usual';
    return '${change.abs().round()}% ${change < 0 ? 'lower' : 'higher'} than usual';
  }
}
