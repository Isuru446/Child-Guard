import 'package:flutter/material.dart';

import '../../core/backend.dart';
import '../../core/app_colors.dart';
import '../../core/phone_actions.dart';
import '../../core/widgets/backend_panels.dart';
import '../../models/user_role.dart';
import '../map/map_screen.dart';
import '../pickup/pickup_screen.dart';
import '../profile/emergency_contacts_screen.dart';

class SosAlertScreen extends StatelessWidget {
  final UserRole userRole;
  final String studentName, emergencyContact;
  final VoidCallback? onViewLocation;
  const SosAlertScreen({
    super.key,
    this.userRole = UserRole.parent,
    this.studentName = '',
    this.emergencyContact = '',
    this.onViewLocation,
  });
  @override
  Widget build(BuildContext context) {
    final circle = (MediaQuery.sizeOf(context).height * .32).clamp(
      140.0,
      260.0,
    );
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFFFF3B45), Color(0xFFE50921)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(22, 6, 22, 24),
              child: Column(
                children: [
                  Row(
                    children: [
                      IconButton(
                        onPressed: () => Navigator.maybePop(context),
                        icon: const Icon(
                          Icons.arrow_back_rounded,
                          color: Colors.white,
                        ),
                      ),
                      const Expanded(
                        child: Text(
                          'Emergency SOS',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 48),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Container(
                    width: circle,
                    height: circle,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withValues(alpha: .10),
                    ),
                    child: Center(
                      child: Container(
                        width: circle * .78,
                        height: circle * .78,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: .14),
                        ),
                        child: Center(
                          child: Container(
                            width: circle * .54,
                            height: circle * .54,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: Colors.white.withValues(alpha: .16),
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                            child: Icon(
                              Icons.sos_rounded,
                              color: Colors.white,
                              size: circle * .24,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Emergency SOS',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Open the phone dialer, then deliberately press Call. ChildGuard does not automatically call, dispatch help or record a successful call. Emergency dialing works without the backend.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: .9),
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: AppColors.sosRed,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () => openDialer(context, '119'),
                      icon: const Icon(Icons.call_rounded),
                      label: const Text('Call Police Emergency — 119'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => userRole == UserRole.teacher
                              ? const ParentCallScreen()
                              : EmergencyContactsScreen(userRole: userRole),
                        ),
                      ),
                      icon: const Icon(Icons.contact_phone_outlined),
                      label: Text(
                        userRole == UserRole.teacher
                            ? "Call a Child's Parent"
                            : 'My emergency contacts',
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: () {
                      if (onViewLocation != null) {
                        Navigator.pop(context);
                        onViewLocation!();
                      } else {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => MapScreen(userRole: userRole),
                          ),
                        );
                      }
                    },
                    child: const Text(
                      'View Live Location',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> openDialer(BuildContext context, String phone) async {
  final opened = await PhoneActions.dial(phone);
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          opened
              ? 'Dialer opened. Press Call yourself; no call completion is confirmed.'
              : 'Phone dialer unavailable on this device. No call was placed.',
        ),
      ),
    );
  }
}

class ParentCallScreen extends StatefulWidget {
  final String? childId;
  const ParentCallScreen({super.key, this.childId});
  @override
  State<ParentCallScreen> createState() => _ParentCallScreenState();
}

class _ParentCallScreenState extends State<ParentCallScreen> {
  late String? selected = widget.childId;
  Future<Map<String, dynamic>> load() async {
    final api = BackendSession.instance.api,
        children = await BackendSession.instance.api.all(
          '/api/v1/mobile/children',
        );
    if (children.isEmpty) return {'children': children, 'contacts': []};
    final child = selected == null
        ? children.first
        : children.where((c) => c['id'] == selected).firstOrNull;
    if (child == null) {
      throw const ApiFailure('Child is no longer authorized.', 404);
    }
    final contacts = await api.request(
      '/api/v1/mobile/children/${child['id']}/parent-contacts',
    );
    return {'children': children, 'child': child, 'contacts': contacts};
  }

  @override
  Widget build(BuildContext context) => PickupShell(
    title: "Call a Child's Parent",
    child: BackendFeed(
      key: ValueKey(selected),
      load: load,
      builder: (context, value) {
        final data = value as Map, children = data['children'] as List;
        if (children.isEmpty) {
          return const Card(
            child: ListTile(title: Text('No authorized children available.')),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              initialValue: data['child']['id'],
              decoration: const InputDecoration(labelText: 'Child'),
              items: children
                  .map(
                    (c) => DropdownMenuItem<String>(
                      value: c['id'],
                      child: Text(c['name']),
                    ),
                  )
                  .toList(),
              onChanged: (id) => setState(() => selected = id),
            ),
            const SizedBox(height: 16),
            if ((data['contacts'] as List).isEmpty)
              const Card(
                child: ListTile(
                  title: Text('No active Parent/Guardian contacts linked.'),
                ),
              ),
            for (final contact in data['contacts'] as List)
              Card(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                ),
                child: ListTile(
                  leading: const Icon(
                    Icons.person_outline_rounded,
                    color: AppColors.primaryBlue,
                  ),
                  title: Text(contact['name']),
                  subtitle: Text(
                    '${contact['relationship']}\n${contact['phone'] ?? 'Phone number unavailable'}\nSaved profile number; phone ownership has not been verified.',
                  ),
                  trailing: IconButton(
                    tooltip: 'Call Parent',
                    onPressed: contact['phone'] == null
                        ? null
                        : () => openDialer(context, contact['phone']),
                    icon: const Icon(Icons.call_outlined),
                  ),
                ),
              ),
          ],
        );
      },
    ),
  );
}
