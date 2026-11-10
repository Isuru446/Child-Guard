import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/demo_security_store.dart';
import '../../models/user_role.dart';
import '../auth/role_selection_screen.dart';

class ChangePasswordDialog extends StatefulWidget {
  final UserRole userRole;

  const ChangePasswordDialog({super.key, required this.userRole});

  @override
  State<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _currentPassword = TextEditingController();
  final _newPassword = TextEditingController();
  final _confirmPassword = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _currentPassword.dispose();
    _newPassword.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    if (BackendSession.instance.signedIn) {
      setState(() => _saving = true);
      try {
        await BackendSession.instance.api.request(
          '/api/v1/mobile/password',
          method: 'POST',
          body: {
            'currentPassword': _currentPassword.text,
            'newPassword': _newPassword.text,
          },
        );
        if (mounted) {
          Navigator.pop(context, true);
        }
        await BackendSession.instance.logout();
      } catch (error) {
        if (mounted) {
          setState(() => _error = error.toString());
        }
      } finally {
        if (mounted) {
          setState(() => _saving = false);
        }
      }
      return;
    }
    final changed = DemoSecurityStore.changePassword(
      widget.userRole,
      currentPassword: _currentPassword.text,
      newPassword: _newPassword.text,
    );
    if (!changed) {
      setState(() => _error = 'Current password is incorrect.');
      return;
    }
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _currentPassword,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Current password',
                ),
              ),
              TextFormField(
                controller: _newPassword,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'New password'),
                validator: (value) {
                  if ((value ?? '').length <
                      (BackendSession.instance.signedIn ? 12 : 6)) {
                    return BackendSession.instance.signedIn
                        ? 'Use at least 12 characters.'
                        : 'Use at least 6 characters.';
                  }
                  return null;
                },
              ),
              TextFormField(
                controller: _confirmPassword,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirm new password',
                ),
                validator: (value) => value != _newPassword.text
                    ? 'Passwords do not match.'
                    : null,
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: AppColors.sosRed)),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: const Text('Update password'),
        ),
      ],
    );
  }
}

class AuthorizedGuardiansScreen extends StatefulWidget {
  const AuthorizedGuardiansScreen({super.key});

  @override
  State<AuthorizedGuardiansScreen> createState() =>
      _AuthorizedGuardiansScreenState();
}

class _AuthorizedGuardiansScreenState extends State<AuthorizedGuardiansScreen> {
  Future<void> _addGuardian() async {
    final guardian = await showDialog<DemoGuardian>(
      context: context,
      builder: (_) => const _AddGuardianDialog(),
    );
    if (guardian == null) return;
    setState(
      () => DemoSecurityStore.addGuardian(guardian.name, guardian.relationship),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return const UnavailablePanel(
        title: 'Authorized guardians',
        message: 'Guardian management is unavailable through the backend. Contact your administrator.',
      );
    }
    final guardians = DemoSecurityStore.guardians;
    return Scaffold(
      appBar: AppBar(title: const Text('Authorized guardians')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addGuardian,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: const Text('Add guardian'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          const _DemoNotice(
            text: 'Demo only: guardian changes stay in this app session and are not shared with a school or backend.',
          ),
          const SizedBox(height: 16),
          if (guardians.isEmpty)
            const Center(child: Text('No guardians added yet.')),
          for (final guardian in guardians)
            Card(
              child: ListTile(
                leading: const CircleAvatar(
                  child: Icon(Icons.person_outline_rounded),
                ),
                title: Text(guardian.name),
                subtitle: Text(guardian.relationship),
                trailing: IconButton(
                  tooltip: 'Remove ${guardian.name}',
                  onPressed: () => setState(
                    () => DemoSecurityStore.removeGuardian(guardian),
                  ),
                  icon: const Icon(
                    Icons.remove_circle_outline_rounded,
                    color: AppColors.sosRed,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AddGuardianDialog extends StatefulWidget {
  const _AddGuardianDialog();

  @override
  State<_AddGuardianDialog> createState() => _AddGuardianDialogState();
}

class _AddGuardianDialogState extends State<_AddGuardianDialog> {
  final _nameController = TextEditingController();
  final _relationshipController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _relationshipController.dispose();
    super.dispose();
  }

  void _add() {
    final name = _nameController.text.trim();
    final relationship = _relationshipController.text.trim();
    if (name.isEmpty || relationship.isEmpty) return;
    Navigator.pop(
      context,
      DemoGuardian(name: name, relationship: relationship),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add trusted guardian'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _nameController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name'),
          ),
          TextField(
            controller: _relationshipController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Relationship'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _add, child: const Text('Add')),
      ],
    );
  }
}

class ActiveSessionsScreen extends StatefulWidget {
  final UserRole userRole;

  const ActiveSessionsScreen({super.key, required this.userRole});

  @override
  State<ActiveSessionsScreen> createState() => _ActiveSessionsScreenState();
}

class _ActiveSessionsScreenState extends State<ActiveSessionsScreen> {
  Future<void> _endSession(DemoSession session) async {
    if (session.isCurrent) {
      final shouldSignOut = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Sign out of this device?'),
          content: const Text('You will return to the role selection screen.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Sign out'),
            ),
          ],
        ),
      );
      if (shouldSignOut != true || !mounted) return;
      DemoSecurityStore.endSession(session.id);
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const RoleSelectionScreen()),
        (_) => false,
      );
      return;
    }

    setState(() => DemoSecurityStore.endSession(session.id));
  }

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return const UnavailablePanel(
        title: 'Active sessions',
        message: 'Remote session management is unavailable. Logout clears this device session; existing JWTs expire after one hour.',
      );
    }
    final sessions = DemoSecurityStore.sessionsFor(widget.userRole);
    return Scaffold(
      appBar: AppBar(title: const Text('Active sessions')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const _DemoNotice(
            text: 'Demo only: sessions are tracked in app memory on this device. A backend is required to show or sign out other devices.',
          ),
          const SizedBox(height: 16),
          if (sessions.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.devices_outlined),
                title: Text('No active demo sessions'),
                subtitle: Text('Sign in to create a session for this device.'),
              ),
            ),
          for (final session in sessions)
            Card(
              child: ListTile(
                leading: Icon(
                  session.isCurrent
                      ? Icons.phone_android_rounded
                      : Icons.devices_rounded,
                ),
                title: Text(session.deviceName),
                subtitle: Text(
                  '${session.isCurrent ? 'This device' : 'Signed in'} · '
                  '${MaterialLocalizations.of(context).formatShortDate(session.signedInAt)}',
                ),
                trailing: TextButton(
                  onPressed: () => _endSession(session),
                  child: Text(session.isCurrent ? 'Sign out' : 'End session'),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DemoNotice extends StatelessWidget {
  final String text;

  const _DemoNotice({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7E6),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFFE0A3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, color: Color(0xFF9A6700)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: Color(0xFF6B4E16),
                height: 1.4,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
