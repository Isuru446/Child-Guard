import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' show TileProvider;

import '../../core/backend.dart';
import '../../core/map_actions.dart';
import '../../core/app_colors.dart';
import '../../core/widgets/backend_panels.dart';
import '../../core/widgets/teacher_alert_card.dart' show alertTime;
import 'recorded_location.dart';
import 'stored_location_map.dart';

/// Uses only stored, child-authorized wearable evidence, never phone GPS.
class WearableLocationPanel extends StatefulWidget {
  final TileProvider? tileProvider;
  const WearableLocationPanel({super.key, this.tileProvider});
  @override
  State<WearableLocationPanel> createState() => _WearableLocationPanelState();
}

class _WearableLocationPanelState extends State<WearableLocationPanel> {
  String? selected;
  Future<Json> load() async {
    final api = BackendSession.instance.api;
    final children = await api.all('/api/v1/mobile/children');
    if (children.isEmpty) return {'children': children};
    final selectedAtStart = selected;
    final matches = children.where((c) => c['id'] == selectedAtStart);
    if (selectedAtStart != null && matches.isEmpty) {
      throw const ApiFailure('Child is no longer authorized.', 404);
    }
    final child = selectedAtStart == null ? children.first : matches.first;
    final result = await api.request(
      '/api/v1/mobile/children/${child['id']}/location',
    );
    if (result is! Map || result['child']?['id'] != child['id']) {
      throw const ApiFailure("Unable to verify this child's location.");
    }
    return {
      ...Map<String, dynamic>.from(result),
      'children': children,
      'child': child,
    };
  }

  @override
  Widget build(BuildContext context) => BackendFeed(
    key: ValueKey('$selected:${BackendSession.instance.user?['id']}'),
    tab: 1,
    load: load,
    builder: (context, value) {
      final data = value as Json,
          children = (data['children'] as List).cast<Json>();
      if (children.isEmpty) {
        return const Card(
          child: ListTile(
            leading: Icon(Icons.child_care),
            title: Text('No authorized children linked.'),
          ),
        );
      }
      final child = data['child'] as Json;
      final point = validRecordedPoint(data, child['id'] as String);
      final recent =
          BackendReadStatus.maybeOf(context)?.stale != true &&
          recentRecordedPoint(data, point, DateTime.now());
      final gps = data['gpsMonitoring'] as Map? ?? {};
      final zone = data['geofence'] as Map?;
      final visualZone = validVisualZone(zone);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (children.length == 1)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.child_care),
              title: Text(child['name'] as String),
            )
          else
            DropdownButtonFormField<String>(
              initialValue: child['id'] as String,
              isExpanded: true,
              itemHeight: null,
              isDense: false,
              decoration: const InputDecoration(labelText: 'Child'),
              items: children
                  .map(
                    (c) => DropdownMenuItem(
                      value: c['id'] as String,
                      child: Text(c['name'] as String),
                    ),
                  )
                  .toList(),
              onChanged: (id) => setState(() => selected = id),
            ),
          const SizedBox(height: 12),
          Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            child: Padding(
              padding: const EdgeInsets.all(15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    point == null
                        ? 'No valid stored GPS position.'
                        : recent
                        ? 'Recent recorded GPS fix'
                        : 'Historical GPS position — not a live location',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: point != null && !recent
                          ? Colors.amber.shade900
                          : AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(gpsStatusLabel(gps['latestStatus'])),
                  Text(
                    'Wearable: ${data['device']?['hardwareId'] ?? 'No wearable assigned'}',
                  ),
                  if (data['device'] != null)
                    Text(
                      BackendReadStatus.maybeOf(context)?.stale != true &&
                              recentCommunication(data, DateTime.now())
                          ? 'Connection status at last refresh: Online'
                          : 'Wearable connection is offline or unavailable',
                    ),
                  if (point != null) ...[
                    SelectableText(
                      '${point['latitude']}, ${point['longitude']}',
                    ),
                    Text('GPS observed: ${alertTime(point['observedAt'])}'),
                    Text('Received: ${alertTime(point['receivedAt'])}'),
                  ],
                ],
              ),
            ),
          ),
          if (point != null || visualZone != null)
            StoredLocationMap(
              key: ValueKey(child['id']),
              latitude: ((point?['latitude'] ?? visualZone!['latitude']) as num)
                  .toDouble(),
              longitude:
                  ((point?['longitude'] ?? visualZone!['longitude']) as num)
                      .toDouble(),
              childName: child['name'] as String,
              zone: zone,
              showChild: point != null,
              tileProvider: widget.tileProvider,
            ),
          const SizedBox(height: 10),
          GoogleMapsButton(point: point, historical: !recent),
          if (point == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Google Maps needs a valid recorded wearable location.',
              ),
            ),
          if (zone != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Configured safe zone: ${zone['name'] ?? 'Unnamed'} / ${zone['radiusM']} m / ${zone['active'] == true ? 'Active' : 'Inactive'}',
              ),
            )
          else
            Text(
              data['configurationAvailable'] == true
                  ? 'No safe zone configured.'
                  : 'Safe-zone configuration unavailable.',
            ),
          const SizedBox(height: 8),
          const Text(
            'A previous position or zone membership does not establish that a child is safe.',
            style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
          ),
        ],
      );
    },
  );
}

class GoogleMapsButton extends StatefulWidget {
  final Map<String, dynamic>? point;
  final bool historical;
  const GoogleMapsButton({
    super.key,
    required this.point,
    required this.historical,
  });
  @override
  State<GoogleMapsButton> createState() => _GoogleMapsButtonState();
}

class _GoogleMapsButtonState extends State<GoogleMapsButton> {
  bool busy = false;
  Future<void> open() async {
    final point = widget.point;
    if (busy ||
        point == null ||
        !validCoordinates(point['latitude'], point['longitude'])) {
      return;
    }
    setState(() => busy = true);
    try {
      if (widget.historical) {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Open last known location?'),
            content: const Text(
              'This recorded position is historical. It may not be where your child is now.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Open Location'),
              ),
            ],
          ),
        );
        if (confirmed != true || !mounted) return;
      }
      // The selected child's coordinates must not change while a confirmation is open.
      if (!mounted ||
          widget.point?['recordedChildId'] != point['recordedChildId'] ||
          widget.point?['latitude'] != point['latitude'] ||
          widget.point?['longitude'] != point['longitude'] ||
          widget.point?['observedAt'] != point['observedAt']) {
        return;
      }
      final ok = await MapActions.open(
        point['latitude'] as num,
        point['longitude'] as num,
      );
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to open Google Maps. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => FilledButton.icon(
    onPressed:
        busy ||
            widget.point == null ||
            !validCoordinates(
              widget.point?['latitude'],
              widget.point?['longitude'],
            )
        ? null
        : open,
    icon: Icon(busy ? Icons.hourglass_top : Icons.open_in_new),
    label: const Text('Open in Google Maps'),
  );
}
