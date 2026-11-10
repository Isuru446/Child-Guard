import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/app_colors.dart';
import '../../core/backend.dart';
import '../../core/phone_actions.dart';
import '../../core/pickup_api.dart';
import '../../core/widgets/backend_panels.dart';
import '../../widgets/brand_logo.dart';

typedef PickupJson = Map<String, dynamic>;

String pickupTime(dynamic value) {
  final instant = value is String ? DateTime.tryParse(value) : null;
  if (instant == null) return 'Unavailable';
  final local = instant.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${local.toIso8601String().substring(0, 16).replaceFirst('T', ' ')} (Sri Lanka)';
}

/// Shares the existing registration header, rounded cards and brand palette.
class PickupShell extends StatelessWidget {
  final String title;
  final Widget child;
  const PickupShell({super.key, required this.title, required this.child});
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.background,
    body: SafeArea(
      top: false,
      child: SingleChildScrollView(
        child: Column(
          children: [
            Container(
              padding: EdgeInsets.fromLTRB(
                12,
                MediaQuery.paddingOf(context).top + 12,
                20,
                22,
              ),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppColors.primaryBlue, Color(0xFF0077B6)],
                ),
                borderRadius: BorderRadius.vertical(
                  bottom: Radius.circular(32),
                ),
              ),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.maybePop(context),
                    icon: const Icon(
                      Icons.arrow_back_rounded,
                      color: Colors.white,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const BrandLogo(size: 42),
                ],
              ),
            ),
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Padding(padding: const EdgeInsets.all(18), child: child),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class PickupPhoto extends StatelessWidget {
  final String id;
  final double size;
  const PickupPhoto(this.id, {super.key, this.size = 64});
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(14),
    child: Image.network(
      BackendSession.instance.api.base
          .resolve('${PickupApi.root}/photos/$id')
          .toString(),
      headers: {'Authorization': 'Bearer ${BackendSession.instance.api.token}'},
      width: size,
      height: size,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => SizedBox(
        width: size,
        height: size,
        child: const Icon(
          Icons.person_outline_rounded,
          color: AppColors.textSecondary,
        ),
      ),
    ),
  );
}

class PickupScreen extends StatefulWidget {
  const PickupScreen({super.key});
  @override
  State<PickupScreen> createState() => _PickupScreenState();
}

class _PickupScreenState extends State<PickupScreen> {
  String? selected;
  String filter = 'Pending';
  bool busy = false;
  bool get teacher => BackendSession.instance.user?['role'] == 'TEACHER';
  final pickup = PickupApi();
  Future<PickupJson> load() async {
    final children = await BackendSession.instance.api.all(
      '/api/v1/mobile/children',
    );
    if (children.isEmpty) {
      return {'children': children, 'people': [], 'requests': []};
    }
    final chosen = selected == null
        ? children.first
        : children.where((c) => c['id'] == selected).firstOrNull;
    if (chosen == null) {
      throw const ApiFailure('This child is no longer authorized.', 404);
    }
    final id = chosen['id'];
    final requests =
        await pickup.read('requests${teacher ? '' : '?childId=$id'}') as List;
    final people = teacher
        ? []
        : await pickup.read('people?childId=$id') as List;
    return {
      'children': children,
      'child': chosen,
      'people': people,
      'requests': requests,
    };
  }

  void refresh() => backendRefresh.value++;
  void error(Object e) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ApiFailure
                ? e.message
                : 'Pickup could not be saved. Refresh before trying again.',
          ),
        ),
      );
    }
  }

  Future<void> edit(PickupJson child, [PickupJson? person]) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => PickupPersonForm(child: child, person: person),
      ),
    );
    if (saved == true) refresh();
  }

  Future<bool> confirm(String title, String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirm'),
            ),
          ],
        ),
      ) ==
      true;
  Future<void> request(PickupJson child, List people) async {
    if (!mounted || busy) return;
    final active = people.where((p) => p['active'] == true).toList();
    if (active.isEmpty) {
      error(
        const ApiFailure(
          'Add an active pickup person with a photograph first.',
        ),
      );
      return;
    }
    final person = await showModalBottomSheet<PickupJson>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Request Pickup',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const Text(
                  "Today's pickup window: now until the next hour or midnight (Sri Lanka). Review the person before confirming.",
                ),
                for (final p in active)
                  Card(
                    child: ListTile(
                      leading: PickupPhoto(p['photoId']),
                      title: Text(p['fullName']),
                      subtitle: Text(
                        '${p['address']}\n${p['phone']} / ${p['relationship'] ?? ''}',
                      ),
                      onTap: () =>
                          Navigator.pop(context, Map<String, dynamic>.from(p)),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    if (person == null || !mounted) return;
    if (!await confirm(
      'Authorize pickup?',
      '${child['name']}\n${person['fullName']}\n${person['address']}\n${person['phone']}\n\nToday’s next-hour window. The Teacher must still verify photo, identification and code.',
    )) {
      return;
    }
    if (!mounted) return;
    setState(() => busy = true);
    try {
      final issued = await pickup.post('requests', {
        'childId': child['id'],
        'personId': person['id'],
      }) as Map;
      refresh();
      if (mounted) await showPickupCode(context, issued);
    } catch (e) {
      error(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PickupShell(
    title: teacher ? 'Teacher Pickup' : 'Authorized Pickups',
    child: BackendFeed(
      key: ValueKey(selected),
      load: load,
      builder: (context, value) {
        final data = value as PickupJson, children = data['children'] as List;
        if (children.isEmpty) {
          return const Card(
            child: ListTile(title: Text('No authorized children available.')),
          );
        }
        final child = data['child'] as PickupJson;
        final requests = (data['requests'] as List).where(
          (r) => filter == 'Pending'
              ? r['status'] == 'PENDING'
              : filter == 'Completed'
              ? r['status'] == 'COMPLETED'
              : !['PENDING', 'COMPLETED'].contains(r['status']),
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!teacher) ...[
              DropdownButtonFormField<String>(
                initialValue: child['id'],
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
              const SizedBox(height: 14),
              const Text(
                'My Pickup Persons',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              if ((data['people'] as List).isEmpty)
                const Card(
                  child: ListTile(
                    title: Text('No pickup persons saved for this child.'),
                  ),
                ),
              for (final p in data['people'] as List)
                Card(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: ListTile(
                    leading: PickupPhoto(p['photoId']),
                    title: Text(
                      '${p['fullName']}${p['active'] == true ? '' : ' · Inactive'}',
                    ),
                    subtitle: Text('${p['phone']}\n${p['address']}'),
                    isThreeLine: true,
                    trailing: p['active'] != true
                        ? null
                        : PopupMenuButton<String>(
                            onSelected: (action) async {
                              if (action == 'edit') {
                                await edit(child, Map<String, dynamic>.from(p));
                                return;
                              }
                              if (busy ||
                                  !await confirm(
                                    'Deactivate pickup person?',
                                    'Pending requests for this person will be cancelled. History is retained.',
                                  )) {
                                return;
                              }
                              setState(() => busy = true);
                              try {
                                await pickup.post(
                                  'people/${p['id']}/deactivate',
                                );
                                refresh();
                              } catch (e) {
                                error(e);
                              } finally {
                                if (mounted) setState(() => busy = false);
                              }
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(
                                value: 'edit',
                                child: Text('Edit information / photo'),
                              ),
                              const PopupMenuItem(
                                value: 'deactivate',
                                child: Text('Deactivate'),
                              ),
                            ],
                          ),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: busy ? null : () => edit(child),
                icon: const Icon(Icons.person_add_alt_1),
                label: const Text('Add pickup person'),
              ),
              FilledButton.icon(
                onPressed: busy ? null : () => request(child, data['people']),
                icon: const Icon(Icons.verified_user_outlined),
                label: const Text('Request Pickup'),
              ),
            ],
            const SizedBox(height: 18),
            const Text(
              'Pickup Request History',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            Wrap(
              spacing: 8,
              children:
                  ['Pending', 'Completed', 'Cancelled / Expired / Rejected']
                      .map(
                        (s) => ChoiceChip(
                          label: Text(s),
                          selected: filter == s,
                          onSelected: (_) => setState(() => filter = s),
                        ),
                      )
                      .toList(),
            ),
            if (requests.isEmpty)
              const Card(
                child: ListTile(
                  title: Text('No pickup requests in this view.'),
                ),
              ),
            for (final r in requests)
              Card(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                ),
                child: ListTile(
                  leading: PickupPhoto(r['photoId']),
                  title: Text('${r['snapshot']['childName']} · ${r['status']}'),
                  subtitle: Text(
                    '${r['snapshot']['fullName']}\n${r['day']} / Parent: ${r['requestedBy']?['username'] ?? 'Recorded Parent'}',
                  ),
                  onTap: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => PickupDetailScreen(id: r['id']),
                      ),
                    );
                    refresh();
                  },
                ),
              ),
            const Text(
              'Latest 100 requests. Pickup confirmation is separate from attendance; it does not automatically check a child out.',
              style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
          ],
        );
      },
    ),
  );
}

class PickupPersonForm extends StatefulWidget {
  final PickupJson child;
  final PickupJson? person;
  final Future<XFile?> Function(ImageSource)? pickPhoto;
  const PickupPersonForm({
    super.key,
    required this.child,
    this.person,
    this.pickPhoto,
  });
  @override
  State<PickupPersonForm> createState() => _PickupPersonFormState();
}

class _PickupPersonFormState extends State<PickupPersonForm> {
  final form = GlobalKey<FormState>();
  late final name = TextEditingController(text: widget.person?['fullName']);
  late final address = TextEditingController(text: widget.person?['address']);
  late final phone = TextEditingController(text: widget.person?['phone']);
  late final relationship = TextEditingController(
    text: widget.person?['relationship'],
  );
  Uint8List? photo;
  bool busy = false;
  String? error;
  @override
  void dispose() {
    name.dispose();
    address.dispose();
    phone.dispose();
    relationship.dispose();
    super.dispose();
  }

  Future<void> choose(ImageSource source) async {
    try {
      final image = widget.pickPhoto != null
          ? await widget.pickPhoto!(source)
          : await ImagePicker().pickImage(
              source: source,
              maxWidth: 1600,
              maxHeight: 1600,
              imageQuality: 85,
            );
      if (image == null) return;
      if (await image.length() > 2 * 1024 * 1024) {
        throw const ApiFailure('Choose a photo up to 2 MB.');
      }
      final bytes = await image.readAsBytes();
      if (mounted) {
        setState(() {
          photo = bytes;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is ApiFailure
              ? e.message
              : 'Photo selection unavailable. Try the gallery.',
        );
      }
    }
  }

  Future<void> save() async {
    if (busy || !form.currentState!.validate()) return;
    if (photo == null && widget.person == null) {
      setState(() => error = 'Select a real photograph.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final pickup = PickupApi();
      final sentToken = pickup.api.token;
      final photoId = photo == null
          ? widget.person!['photoId']
          : await pickup.upload(widget.child['id'], photo!);
      if (!mounted) return;
      if (pickup.api.token != sentToken) {
        throw const ApiFailure('Session changed. Reopen Pickup before saving.');
      }
      final body = <String, dynamic>{
        'childId': widget.child['id'],
        'fullName': name.text.trim(),
        'address': address.text.trim(),
        'phone': phone.text.trim(),
        'relationship': relationship.text.trim(),
        'photoId': photoId,
      };
      if (widget.person == null) {
        await pickup.post('people', body);
      } else {
        await pickup.api.request(
          '${PickupApi.root}/people/${widget.person!['id']}',
          method: 'PATCH',
          body: body,
        );
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is ApiFailure
              ? e.message
              : 'Could not save. Refresh before retrying.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PickupShell(
    title: widget.person == null ? 'Add Pickup Person' : 'Edit Pickup Person',
    child: Form(
      key: form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Authorized for ${widget.child['name']}',
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  if (photo != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: Image.memory(
                        photo!,
                        width: 120,
                        height: 120,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            const Icon(Icons.broken_image_outlined),
                      ),
                    )
                  else if (widget.person != null)
                    PickupPhoto(widget.person!['photoId'], size: 120)
                  else
                    const Icon(
                      Icons.add_a_photo_outlined,
                      size: 64,
                      color: AppColors.accentBlue,
                    ),
                  Wrap(
                    spacing: 8,
                    children: [
                      TextButton.icon(
                        onPressed: busy
                            ? null
                            : () => choose(ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_outlined),
                        label: const Text('Gallery'),
                      ),
                      TextButton.icon(
                        onPressed: busy
                            ? null
                            : () => choose(ImageSource.camera),
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Camera'),
                      ),
                    ],
                  ),
                  const Text(
                    'Private JPEG, PNG or WebP · up to 2 MB',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Full name'),
                    maxLength: 150,
                    validator: (v) =>
                        (v?.trim().length ?? 0) < 2 ? 'Enter full name' : null,
                  ),
                  TextFormField(
                    controller: address,
                    decoration: const InputDecoration(
                      labelText: 'Residential address',
                    ),
                    maxLength: 500,
                    maxLines: 3,
                    validator: (v) => (v?.trim().length ?? 0) < 5
                        ? 'Enter residential address'
                        : null,
                  ),
                  TextFormField(
                    controller: phone,
                    decoration: const InputDecoration(
                      labelText: 'Phone number',
                    ),
                    keyboardType: TextInputType.phone,
                    maxLength: 30,
                    validator: (v) {
                      final s = v ?? '',
                          digits = s.replaceAll(RegExp(r'\D'), '');
                      return !RegExp(r'^\+?[0-9 ()-]+$').hasMatch(s) ||
                              digits.length < 7 ||
                              digits.length > 15
                          ? 'Enter a valid phone number'
                          : null;
                    },
                  ),
                  TextFormField(
                    controller: relationship,
                    decoration: const InputDecoration(
                      labelText: 'Relationship (optional)',
                    ),
                    maxLength: 80,
                  ),
                ],
              ),
            ),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                error!,
                style: const TextStyle(color: AppColors.sosRed),
              ),
            ),
          if (busy) const LinearProgressIndicator(),
          FilledButton(
            onPressed: busy ? null : save,
            child: const Text('Save pickup person'),
          ),
        ],
      ),
    ),
  );
}

Future<void> showPickupCode(
  BuildContext context,
  Map issued,
) => showDialog<void>(
  context: context,
  builder: (context) => AlertDialog(
    title: const Text('Pickup authorization issued'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SelectableText(issued['message'] as String),
          const SizedBox(height: 12),
          const Text(
            'Shown only when issued. Closing this dialog does not send a message. Regenerate if you lose the code; the previous code will stop working.',
          ),
          Wrap(
            spacing: 6,
            children: [
              TextButton(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: issued['code']));
                },
                child: const Text('Copy Code'),
              ),
              TextButton(
                onPressed: () async {
                  await Clipboard.setData(
                    ClipboardData(text: issued['message']),
                  );
                },
                child: const Text('Copy Message'),
              ),
              TextButton(
                onPressed: () async {
                  final opened = await PhoneActions.share(issued['message']);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          opened
                              ? 'Share sheet opened. Delivery is not confirmed.'
                              : 'Sharing unavailable. Copy the message instead.',
                        ),
                      ),
                    );
                  }
                },
                child: const Text('Share Message'),
              ),
              TextButton(
                onPressed: () async {
                  final opened = await PhoneActions.message(
                    issued['request']['snapshot']['phone'],
                    issued['message'],
                  );
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          opened
                              ? 'SMS composer opened. Press Send yourself; delivery is not confirmed.'
                              : 'SMS composer unavailable. Copy or share the message.',
                        ),
                      ),
                    );
                  }
                },
                child: const Text('Send SMS'),
              ),
            ],
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    ],
  ),
);

class PickupDetailScreen extends StatefulWidget {
  final String id;
  const PickupDetailScreen({super.key, required this.id});
  @override
  State<PickupDetailScreen> createState() => _PickupDetailScreenState();
}

class _PickupDetailScreenState extends State<PickupDetailScreen> {
  final code = TextEditingController();
  bool checked = false, handover = false, busy = false;
  String? token, error;
  final pickup = PickupApi();
  bool get teacher => BackendSession.instance.user?['role'] == 'TEACHER';
  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  Future<void> action(String name, [Map<String, dynamic>? body]) async {
    if (!mounted || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result =
          await pickup.post('requests/${widget.id}/$name', body) as Map;
      if (!mounted) return;
      if (name == 'verify') {
        token = result['handoverToken'];
        code.clear();
      }
      if (name == 'regenerate' && mounted) {
        token = null;
        await showPickupCode(context, result);
      }
      backendRefresh.value++;
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is ApiFailure
              ? e.message
              : 'Request failed. Refresh before retrying.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> rejectRequest() async {
    String reason = '';
    final form = GlobalKey<FormState>();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reject pickup request'),
        content: Form(
          key: form,
          child: TextFormField(
            onChanged: (value) => reason = value,
            validator: (value) => (value?.trim().length ?? 0) < 3
                ? 'Enter a short reason (at least 3 characters).'
                : null,
            maxLength: 300,
            decoration: const InputDecoration(
              labelText: 'Reason (at least 3 characters)',
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              if (form.currentState!.validate()) {
                Navigator.pop(context, reason.trim());
              }
            },
            child: const Text('Reject'),
          ),
        ],
      ),
    );
    if (value != null) await action('reject', {'reason': value});
  }

  @override
  Widget build(BuildContext context) => PickupShell(
    title: 'Pickup Details',
    child: BackendFeed(
      load: () => pickup.read('requests/${widget.id}'),
      builder: (context, value) {
        final r = value as Map,
            p = r['snapshot'] as Map,
            pending = r['status'] == 'PENDING',
            owner = r['requestedById'] == BackendSession.instance.user?['id'];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(child: PickupPhoto(r['photoId'], size: 160)),
                    const SizedBox(height: 12),
                    Text(
                      '${p['childName']} · ${r['status']}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    Text(
                      '${p['fullName']}\n${p['address']}\n${p['phone']}\n${p['relationship'] ?? ''}',
                    ),
                    Text(
                      'Center: ${p['centerName']}\nRequesting Parent: ${r['requestedBy']?['username']}\nWindow: ${pickupTime(r['windowStart'])} – ${pickupTime(r['windowEnd'])}\nCode expires: ${pickupTime(r['expiresAt'])}\nCreated: ${pickupTime(r['createdAt'])}\nCompleted: ${r['completedAt'] == null ? 'Not completed' : pickupTime(r['completedAt'])}\nReviewed by: ${r['reviewedBy']?['username'] ?? 'Not reviewed'}',
                    ),
                    if (r['reason'] != null) Text('Reason: ${r['reason']}'),
                    const Text(
                      'Identity is checked manually by the Teacher. The app does not perform face recognition or automatically confirm identity.',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  error!,
                  style: const TextStyle(color: AppColors.sosRed),
                ),
              ),
            if (busy) const LinearProgressIndicator(),
            if (pending && teacher) ...[
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: checked,
                onChanged: busy
                    ? null
                    : (v) => setState(() => checked = v ?? false),
                title: const Text(
                  'I compared the saved photo and checked identification',
                ),
              ),
              if (token == null) ...[
                TextField(
                  controller: code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'Code provided by pickup person',
                  ),
                ),
                FilledButton(
                  onPressed: busy || !checked
                      ? null
                      : () {
                          if (code.text.length == 6) {
                            action('verify', {'code': code.text});
                          } else {
                            setState(
                              () => error = 'Enter the six-digit code provided by the pickup person.',
                            );
                          }
                        },
                  child: const Text('Verify pickup code'),
                ),
              ] else ...[
                const Text(
                  'Code verified for this Teacher. Confirm handover within five minutes and before expiry.',
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: handover,
                  onChanged: busy
                      ? null
                      : (v) => setState(() => handover = v ?? false),
                  title: const Text(
                    'I am physically handing this child to the identified pickup person',
                  ),
                ),
                FilledButton(
                  onPressed: busy || !checked || !handover
                      ? null
                      : () async {
                          final confirm = await showDialog<bool>(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: const Text('Confirm physical handover?'),
                              content: Text(
                                '${p['childName']} to ${p['fullName']}. This records your Teacher confirmation; attendance is unchanged.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () =>
                                      Navigator.pop(context, false),
                                  child: const Text('Cancel'),
                                ),
                                FilledButton(
                                  onPressed: () => Navigator.pop(context, true),
                                  child: const Text('Complete pickup'),
                                ),
                              ],
                            ),
                          );
                          if (confirm == true) {
                            await action('complete', {
                              'handoverToken': token,
                              'identityChecked': true,
                              'physicalHandover': true,
                            });
                          }
                        },
                  child: const Text('Confirm physical handover'),
                ),
              ],
              TextButton(
                onPressed: busy ? null : rejectRequest,
                child: const Text('Reject request'),
              ),
            ],
            if (pending && !teacher && owner) ...[
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () async {
                        final okay = await showDialog<bool>(
                          context: context,
                          builder: (context) => AlertDialog(
                            title: const Text('Invalidate previous code?'),
                            content: const Text(
                              'A new code will replace the previous code and any in-progress Teacher verification.',
                            ),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(context, false),
                                child: const Text('Keep current code'),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(context, true),
                                child: const Text('Regenerate'),
                              ),
                            ],
                          ),
                        );
                        if (okay == true) await action('regenerate');
                      },
                child: const Text('Regenerate / share new code'),
              ),
              TextButton(
                onPressed: busy ? null : () => action('cancel'),
                child: const Text('Cancel pending request'),
              ),
            ],
          ],
        );
      },
    ),
  );
}
