import 'account_management_screen.dart';
import '../../core/backend.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/app_avatar.dart';
import '../../core/widgets/responsive_content.dart';

class TeacherProfileScreen extends StatefulWidget {
  const TeacherProfileScreen({super.key});

  @override
  State<TeacherProfileScreen> createState() => _TeacherProfileScreenState();
}

class _TeacherProfileScreenState extends State<TeacherProfileScreen> {
  String _name = 'Ms. Thompson';
  String _email = 'teacher@example.invalid';
  String _school = 'Greenwood Primary';
  String _assignedRoom = 'Children';

  Future<void> _editProfile() async {
    final updatedProfile = await showDialog<_TeacherProfileDetails>(
      context: context,
      builder: (_) => _EditTeacherProfileDialog(
        details: _TeacherProfileDetails(
          name: _name,
          email: _email,
          school: _school,
          assignedRoom: _assignedRoom,
        ),
      ),
    );
    if (updatedProfile == null || !mounted) return;

    setState(() {
      _name = updatedProfile.name;
      _email = updatedProfile.email;
      _school = updatedProfile.school;
      _assignedRoom = updatedProfile.assignedRoom;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Teacher profile updated for this session.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return const AccountManagementScreen();
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          child: ResponsiveContent(
            maxWidth: 600,
            child: Column(
              children: [
                _TeacherProfileHeader(
                  name: _name,
                  school: _school,
                  onBack: () => Navigator.maybePop(context),
                  onEdit: _editProfile,
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 22, 20, 32),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Profile information',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      _ProfileInfoCard(
                        children: [
                          const _ProfileInfoRow(
                            icon: Icons.badge_outlined,
                            label: 'Role',
                            value: 'Teacher',
                          ),
                          _ProfileInfoRow(
                            icon: Icons.email_outlined,
                            label: 'Email address',
                            value: _email,
                          ),
                        ],
                      ),
                      const SizedBox(height: 22),
                      const Text(
                        'Teaching information',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      _ProfileInfoCard(
                        children: [
                          _ProfileInfoRow(
                            icon: Icons.school_outlined,
                            label: 'School',
                            value: _school,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.groups_outlined,
                            label: 'Assigned room',
                            value: _assignedRoom,
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
      ),
    );
  }
}

class _TeacherProfileHeader extends StatelessWidget {
  final VoidCallback onBack;
  final VoidCallback onEdit;
  final String name;
  final String school;

  const _TeacherProfileHeader({
    required this.onBack,
    required this.onEdit,
    required this.name,
    required this.school,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 26),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0B55A5), Color(0xFF062E72)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(30)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                tooltip: context.translate('Back'),
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back_rounded),
                color: Colors.white,
              ),
              const Expanded(
                child: Text(
                  'My Profile',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                tooltip: context.translate('Edit teacher details'),
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined),
                color: Colors.white,
              ),
            ],
          ),
          const SizedBox(height: 16),
          const AppAvatar(
            imageUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
            size: 88,
            fallbackIcon: Icons.person_rounded,
            backgroundColor: Colors.white,
            borderColor: Colors.white,
            borderWidth: 3,
          ),
          const SizedBox(height: 12),
          Text(
            name,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Teacher · $school',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFE2EEFF), fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _ProfileInfoCard extends StatelessWidget {
  final List<_ProfileInfoRow> children;

  const _ProfileInfoCard({required this.children});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0) const Divider(height: 1, indent: 60, endIndent: 16),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _ProfileInfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _ProfileInfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: const Color(0xFFE7F1FF),
            child: Icon(icon, color: AppColors.primaryBlue, size: 19),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TeacherProfileDetails {
  final String name;
  final String email;
  final String school;
  final String assignedRoom;

  const _TeacherProfileDetails({
    required this.name,
    required this.email,
    required this.school,
    required this.assignedRoom,
  });
}

class _EditTeacherProfileDialog extends StatefulWidget {
  final _TeacherProfileDetails details;

  const _EditTeacherProfileDialog({required this.details});

  @override
  State<_EditTeacherProfileDialog> createState() =>
      _EditTeacherProfileDialogState();
}

class _EditTeacherProfileDialogState extends State<_EditTeacherProfileDialog> {
  final _formKey = GlobalKey<FormState>();
  late final _nameController = TextEditingController(text: widget.details.name);
  late final _emailController = TextEditingController(
    text: widget.details.email,
  );
  late final _schoolController = TextEditingController(
    text: widget.details.school,
  );
  late final _roomController = TextEditingController(
    text: widget.details.assignedRoom,
  );

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _schoolController.dispose();
    _roomController.dispose();
    super.dispose();
  }

  String? _required(String? value, String field) {
    if (value == null || value.trim().isEmpty) {
      return context.translate('Enter $field');
    }
    return null;
  }

  String? _validateEmail(String? value) {
    final emailError = _required(value, 'an email address');
    if (emailError != null) return emailError;
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value!.trim())) {
      return context.translate('Enter a valid email address');
    }
    return null;
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.pop(
      context,
      _TeacherProfileDetails(
        name: _nameController.text.trim(),
        email: _emailController.text.trim(),
        school: _schoolController.text.trim(),
        assignedRoom: _roomController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit teacher details'),
      content: SizedBox(
        width: 420,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _nameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: context.translate('Full name'),
                  ),
                  validator: (value) => _required(value, 'a name'),
                ),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    labelText: context.translate('Email address'),
                  ),
                  validator: _validateEmail,
                ),
                TextFormField(
                  controller: _schoolController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: context.translate('School'),
                  ),
                  validator: (value) => _required(value, 'a school'),
                ),
                TextFormField(
                  controller: _roomController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: context.translate('Assigned room'),
                  ),
                  validator: (value) => _required(value, 'an assigned room'),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _save, child: const Text('Save changes')),
      ],
    );
  }
}
