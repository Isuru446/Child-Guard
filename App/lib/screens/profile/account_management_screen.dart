import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/backend.dart';
import '../../core/registration.dart';
import '../auth/registration_child_form.dart';
import 'account_security_screens.dart';
import '../../models/user_role.dart';
import '../../core/widgets/authenticated_back.dart';

class AccountManagementScreen extends StatefulWidget {
  const AccountManagementScreen({super.key});
  @override
  State<AccountManagementScreen> createState() =>
      _AccountManagementScreenState();
}

class _AccountManagementScreenState extends State<AccountManagementScreen> {
  final _name = TextEditingController(),
      _email = TextEditingController(),
      _phone = TextEditingController();
  final _form = GlobalKey<FormState>();
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _contacts = [];
  Map<String, dynamic>? _requests;
  String? _error;
  String? _message;
  bool _busy = false;
  bool _registrationEnabled = false, _profileAvailable = true;
  ApiClient get api => BackendSession.instance.api;
  bool get parent => BackendSession.instance.user?['role'] == 'PARENT';
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      final value = await api.request('/api/v1/mobile/profile') as Map;
      final requests = parent && value['registrationEnabled'] == true
          ? await api.request('/api/v1/account/requests') as Map
          : null;
      if (!mounted) return;
      final profile = value['profile'] as Map?;
      setState(() {
        _profile = profile == null ? {} : Map<String, dynamic>.from(profile);
        _registrationEnabled = value['registrationEnabled'] == true;
        _profileAvailable = value['profileAvailable'] != false;
        _name.text = profile?['fullName'] as String? ?? '';
        _email.text = profile?['email'] as String? ?? '';
        _phone.text = profile?['phone'] as String? ?? '';
        _contacts = (profile?['emergencyContacts'] as List? ?? [])
            .map((v) => Map<String, dynamic>.from(v as Map))
            .toList();
        _requests = requests == null
            ? null
            : Map<String, dynamic>.from(requests);
        _error = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _save() async {
    if (_busy || _profile == null || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await api.request(
        '/api/v1/mobile/profile',
        method: 'PATCH',
        body: {
          'fullName': _name.text.trim(),
          'email': _email.text.trim(),
          'phone': _phone.text.trim(),
          // Preserve loaded contacts even when Teacher controls are hidden:
          // the existing API defaults an omitted list to empty.
          'emergencyContacts': _contacts,
        },
      );
      if (mounted) {
        setState(() => _message = 'Profile saved to ChildGuard.');
      }
      await _load();
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _photo() async {
    try {
      final image = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (image == null) return;
      final bytes = await image.readAsBytes();
      await RegistrationClient().upload(
        bytes,
        bytes.isNotEmpty && bytes[0] == 137 ? 'image/png' : 'image/jpeg',
        account: true,
      );
      await _load();
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    }
  }

  Future<void> _child() async {
    final draft = RegistrationChildDraft();
    final key = GlobalKey<FormState>();
    final dialogRoute = DialogRoute<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('Request child enrollment or Guardian link'),
          content: SingleChildScrollView(
            child: Form(
              key: key,
              child: RegistrationChildForm(
                draft: draft,
                number: 1,
                onChanged: () => update(() {}),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () {
                if (key.currentState!.validate()) {
                  Navigator.pop(context, true);
                }
              },
              child: const Text('Submit request'),
            ),
          ],
        ),
      ),
    );
    final approved = await Navigator.of(context).push(dialogRoute);
    await dialogRoute.completed;
    try {
      if (approved == true) {
        await api.request(
          '/api/v1/account/children',
          method: 'POST',
          body: draft.toJson(),
        );
        await _load();
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      draft.dispose();
    }
  }

  Future<void> _wearable() async {
    final hardware = TextEditingController(), code = TextEditingController();
    try {
      final children = await api.all('/api/v1/mobile/children');
      if (!mounted) return;
      if (children.isEmpty) {
        setState(
          () => _error = 'An approved child relationship is required first.',
        );
        return;
      }
      String childId = children.first['id'] as String;
      final dialogRoute = DialogRoute<bool>(
        context: context,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: const Text('Request wearable assignment'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButton<String>(
                    value: childId,
                    isExpanded: true,
                    items: children
                        .map(
                          (c) => DropdownMenuItem(
                            value: c['id'] as String,
                            child: Text(c['name'] as String),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => update(() => childId = v!),
                  ),
                  TextField(
                    controller: hardware,
                    decoration: const InputDecoration(
                      labelText: 'Device identifier',
                    ),
                  ),
                  TextField(
                    controller: code,
                    decoration: const InputDecoration(
                      labelText: 'One-time claim code',
                    ),
                  ),
                  const Text(
                    'Admin verification is required. Existing assignments are never automatically overwritten.',
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Submit request'),
              ),
            ],
          ),
        ),
      );
      final approved = await Navigator.of(context).push(dialogRoute);
      await dialogRoute.completed;
      if (approved == true) {
        await api.request(
          '/api/v1/account/wearables',
          method: 'POST',
          body: {
            'childId': childId,
            'hardwareId': hardware.text.trim(),
            'claimCode': code.text.trim(),
          },
        );
        await _load();
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      hardware.dispose();
      code.dispose();
    }
  }

  @override
  Widget build(BuildContext context) => AuthenticatedBackScope(
    userRole: parent ? UserRole.parent : UserRole.teacher,
    child: Scaffold(
      appBar: AppBar(
        leading: AuthenticatedBackButton(
          userRole: parent ? UserRole.parent : UserRole.teacher,
        ),
        title: const Text('Account details'),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_busy) const LinearProgressIndicator(),
                  if (_error != null)
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (_message != null) Text(_message!),
                  if (_profile?['photo']?['id'] != null)
                    Image.network(
                      '${api.base}/api/v1/account/photos/${_profile!['photo']['id']}?v=${Uri.encodeQueryComponent(_profile!['photo']['createdAt'].toString())}',
                      headers: {'Authorization': 'Bearer ${api.token}'},
                      height: 100,
                      errorBuilder: (_, _, _) =>
                          const Icon(Icons.account_circle, size: 80),
                    )
                  else
                    const Icon(Icons.account_circle, size: 80),
                  TextButton(
                    onPressed: _busy || !_registrationEnabled ? null : _photo,
                    child: const Text('Replace profile photo'),
                  ),
                  for (final field in [
                    (_name, 'Full name'),
                    (_email, 'Email address'),
                    (_phone, 'Phone number'),
                  ])
                    TextFormField(
                      controller: field.$1,
                      decoration: InputDecoration(labelText: field.$2),
                      validator: (v) =>
                          v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                  const SizedBox(height: 16),
                  if (!_profileAvailable)
                    const Text(
                      'Profile storage is unavailable. Contact your administrator; existing child and wearable access remains available.',
                    ),
                  if (!_registrationEnabled)
                    const Text(
                      'New enrollment, wearable requests and photo changes are disabled by your administrator. Existing approved relationships are unchanged.',
                    ),
                  if (parent) ...[
                    const Text(
                      'Emergency contacts (persisted with your profile)',
                    ),
                    for (var index = 0; index < _contacts.length; index++)
                      Column(
                        children: [
                          for (final key in ['name', 'phone', 'relationship'])
                            TextFormField(
                              initialValue:
                                  _contacts[index][key] as String? ?? '',
                              decoration: InputDecoration(
                                labelText: 'Contact ${index + 1}: $key',
                              ),
                              onChanged: (v) => _contacts[index][key] = v,
                            ),
                          TextButton(
                            onPressed: () =>
                                setState(() => _contacts.removeAt(index)),
                            child: const Text('Remove contact'),
                          ),
                        ],
                      ),
                    if (_contacts.length < 5)
                      TextButton(
                        onPressed: () => setState(
                          () => _contacts.add({
                            'name': '',
                            'phone': '',
                            'relationship': '',
                          }),
                        ),
                        child: const Text('Add emergency contact'),
                      ),
                  ],
                  ElevatedButton(
                    onPressed: _busy || !_profileAvailable || _profile == null
                        ? null
                        : _save,
                    child: const Text('Save profile'),
                  ),
                  TextButton(
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (_) => ChangePasswordDialog(
                        userRole: parent ? UserRole.parent : UserRole.teacher,
                      ),
                    ),
                    child: const Text('Change password'),
                  ),
                  if (parent) ...[
                    TextButton(
                      onPressed: _busy || !_registrationEnabled ? null : _child,
                      child: const Text(
                        'Request child enrollment / Guardian link',
                      ),
                    ),
                    TextButton(
                      onPressed: _busy || !_registrationEnabled
                          ? null
                          : _wearable,
                      child: const Text('Request wearable assignment'),
                    ),
                    for (final child in (_requests?['children'] as List? ?? []))
                      Text(
                        '${child['fullName'] ?? child['existingChildId']}: ${child['status']} / ${child['reason'] ?? ''} / Wearable: ${child['wearable']?['status'] ?? 'Not requested'} ${child['wearable']?['reason'] ?? ''}',
                      ),
                    for (final device
                        in (_requests?['wearables'] as List? ?? []))
                      Text(
                        '${device['hardwareId']}: ${device['status']} / ${device['reason'] ?? ''}',
                      ),
                  ],
                  TextButton(
                    onPressed: _busy ? null : _load,
                    child: const Text('Refresh'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
