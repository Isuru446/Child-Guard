import '../../core/backend.dart';
import '../pickup/pickup_screen.dart';

import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;
import 'package:final_project/core/app_ui.dart';
import 'package:flutter/services.dart';

import '../../core/app_colors.dart';
import '../../widgets/brand_logo.dart';
import 'pickup_confirmation_screen.dart';

class RegisterPickupScreen extends StatefulWidget {
  const RegisterPickupScreen({super.key});

  @override
  State<RegisterPickupScreen> createState() => _RegisterPickupScreenState();
}

class _RegisterPickupScreenState extends State<RegisterPickupScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _relationController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _idController = TextEditingController();

  bool _notifyParent = true;
  Uint8List? _photoBytes;

  @override
  void dispose() {
    _nameController.dispose();
    _relationController.dispose();
    _phoneController.dispose();
    _idController.dispose();
    super.dispose();
  }

  void _handleSubmit() {
    if (_formKey.currentState!.validate()) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (context) =>
              const PickupConfirmationScreen(studentName: 'Sarah'),
        ),
      );
    }
  }

  Future<void> _pickPickupPhoto() async {
    if (defaultTargetPlatform != TargetPlatform.android) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Photo selection is supported on Android in this demo.',
          ),
        ),
      );
      return;
    }

    try {
      final bytes = await const MethodChannel('child_guard/phone')
          .invokeMethod<Uint8List>('pickImage');
      if (bytes == null || !mounted) return;
      setState(() => _photoBytes = bytes);
    } on PlatformException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.message ?? 'Could not select the photo.'),
          ),
        );
      }
    } on MissingPluginException {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Photo selection is not available.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) return const PickupScreen();
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        child: Column(
          children: [
            _buildTopHeader(context),
            const SizedBox(height: 18),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                children: [
                  _buildFormCard(),
                  const SizedBox(height: 16),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'Parent/Guardian will be notified and must approve this registration',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: Color(0xFF64748B),
                        height: 1.4,
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed: _handleSubmit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0077B6),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(26),
                        ),
                      ),
                      child: const Text(
                        'Submit Registration',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopHeader(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.primaryBlue,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 50, 20, 24),
      child: Stack(
        children: [
          Positioned(
            right: -10,
            bottom: -30,
            child: Opacity(opacity: 0.12, child: BrandLogo(size: 110)),
          ),
          Row(
            children: [
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(
                  Icons.arrow_back_ios,
                  color: Colors.white,
                  size: 20,
                ),
                onPressed: () => Navigator.pop(context),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Register Pickup Person',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Child Guard',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFormCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildFieldLabel('Full Name'),
            const SizedBox(height: 6),
            _buildTextField(
              context: context,
              controller: _nameController,
              hintText: 'Enter full name',
            ),
            const SizedBox(height: 16),
            _buildFieldLabel('Relationship to Student'),
            const SizedBox(height: 6),
            _buildTextField(
              context: context,
              controller: _relationController,
              hintText: 'e.g. Grandparent, Uncle',
            ),
            const SizedBox(height: 16),
            _buildFieldLabel('Phone Number'),
            const SizedBox(height: 6),
            _buildTextField(
              context: context,
              controller: _phoneController,
              hintText: 'Enter phone number',
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            _buildFieldLabel('ID / Document Number'),
            const SizedBox(height: 6),
            _buildTextField(
              context: context,
              controller: _idController,
              hintText: 'Enter ID or NIC number',
            ),
            const SizedBox(height: 16),
            _buildFieldLabel('Upload Photo'),
            const SizedBox(height: 8),
            _buildUploadBox(),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text(
                      'Notify Parent',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1E293B),
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Instantly alert via parent app',
                      style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                    ),
                  ],
                ),
                Switch(
                  value: _notifyParent,
                  activeThumbColor: const Color(0xFF0077B6),
                  onChanged: (val) {
                    setState(() {
                      _notifyParent = val;
                    });
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFieldLabel(String label) {
    return Text(
      label,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: Color(0xFF64748B),
      ),
    );
  }

  Widget _buildTextField({
    required BuildContext context,
    required TextEditingController controller,
    required String hintText,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.bold,
        color: Color(0xFF1E293B),
      ),
      decoration: InputDecoration(
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        hintText: context.translate(hintText),
        hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
        contentPadding: const EdgeInsets.symmetric(
          vertical: 14,
          horizontal: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: Color(0xFF0077B6), width: 1.5),
        ),
      ),
      validator: (value) {
        if (value == null || value.trim().isEmpty) {
          return context.translate('This field is required');
        }
        return null;
      },
    );
  }

  Widget _buildUploadBox() {
    return Container(
      width: double.infinity,
      height: 96,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF0077B6).withValues(alpha: 0.5),
          style: BorderStyle.solid,
          width: 1.2,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: _pickPickupPhoto,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_photoBytes == null) ...[
                const Icon(
                  Icons.camera_alt_outlined,
                  color: Color(0xFF0077B6),
                  size: 30,
                ),
                const SizedBox(width: 10),
                const Text(
                  'Choose a photo',
                  style: TextStyle(
                    color: Color(0xFF0077B6),
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ] else ...[
                ClipRRect(
                  borderRadius: const BorderRadius.all(Radius.circular(10)),
                  child: Image.memory(
                    _photoBytes!,
                    width: 62,
                    height: 62,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(width: 12),
                const Text(
                  'Change photo',
                  style: TextStyle(
                    color: Color(0xFF0077B6),
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
