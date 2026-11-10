import 'package:final_project/core/app_ui.dart';
import 'package:flutter/services.dart';

import '../../core/app_colors.dart';
import '../../widgets/brand_logo.dart';
import 'role_selection_screen.dart';
import '../../core/backend.dart';
import '../../models/user_role.dart';
import '../main_wrapper.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(milliseconds: 1200), () async {
      final restored = await BackendSession.instance.restore();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => restored
              ? MainWrapperScreen(
                  userRole: BackendSession.instance.teacher
                      ? UserRole.teacher
                      : UserRole.parent,
                )
              : const RoleSelectionScreen(),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        body: Container(
          width: double.infinity,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF0752AB), Color(0xFF062E72)],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
          ),
          child: SafeArea(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Spacer(),
                const BrandLogo(size: 150),
                const SizedBox(height: 18),
                const Text(
                  'ChildGuard',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 34,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.6,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Student Safety\nMonitoring System',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9),
                    height: 1.45,
                    fontSize: 15,
                  ),
                ),
                const Spacer(),
                const SizedBox(
                  width: 30,
                  height: 30,
                  child: CircularProgressIndicator(
                    value: 0.72,
                    strokeWidth: 2.5,
                    color: AppColors.accentBlue,
                    backgroundColor: Colors.white24,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'Loading...',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 28),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
