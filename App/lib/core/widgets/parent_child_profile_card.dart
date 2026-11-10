import 'package:flutter/material.dart';

/// The current child API has no child-photo field. Adult account and Pickup
/// photographs must never be substituted for a child's profile photograph.
class ParentChildProfileCard extends StatelessWidget {
  final Map<String, dynamic> child;
  final List<Map<String, dynamic>> children;
  final Map<String, dynamic>? device;
  final bool deviceUnavailable;
  final ValueChanged<String> onSelected;
  const ParentChildProfileCard({
    super.key,
    required this.child,
    required this.children,
    required this.device,
    required this.onSelected,
    this.deviceUnavailable = false,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Child profile',
    child: Material(
      color: Theme.of(context).colorScheme.surface,
      elevation: 1,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const CircleAvatar(
              key: ValueKey('child-profile-avatar'),
              radius: 26,
              backgroundColor: Color(0xFFE8F3FF),
              child: Icon(Icons.child_care, color: Color(0xFF22659B), size: 30),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (children.length > 1)
                    DropdownButtonFormField<String>(
                      initialValue: child['id'] as String,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Child',
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 8),
                      ),
                      items: children
                          .map(
                            (c) => DropdownMenuItem(
                              value: c['id'] as String,
                              child: Text(c['name'] as String, softWrap: true),
                            ),
                          )
                          .toList(),
                      onChanged: (id) {
                        if (id != null) onSelected(id);
                      },
                    )
                  else
                    Text(
                      child['name'] as String,
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.watch_outlined,
                        size: 17,
                        color: Color(0xFF22659B),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          deviceUnavailable
                              ? 'Wearable information unavailable'
                              : device == null
                              ? 'No wearable assigned'
                              : device!['hardwareId'] as String? ??
                                    'Wearable ID not available',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
