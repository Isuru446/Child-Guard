import '../../core/app_ui.dart';
import '../../core/registration.dart';
import '../../models/user_role.dart';
import 'register_screen.dart';

/// Availability is server-owned; this check never grants account privileges.
class RegistrationEntryScreen extends StatefulWidget {
  final UserRole selectedRole;
  const RegistrationEntryScreen({super.key, required this.selectedRole});

  @override
  State<RegistrationEntryScreen> createState() =>
      _RegistrationEntryScreenState();
}

class _RegistrationEntryScreenState extends State<RegistrationEntryScreen> {
  final _registration = RegistrationClient();
  late Future<bool> _availability;

  @override
  void initState() {
    super.initState();
    _availability = _registration.availability();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<bool>(
    future: _availability,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.done &&
          !snapshot.hasError &&
          snapshot.data == true) {
        return RegisterScreen(selectedRole: widget.selectedRole);
      }
      return Scaffold(
        appBar: AppBar(title: const Text('Registration')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: snapshot.connectionState != ConnectionState.done
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        snapshot.hasError
                            ? 'Unable to check registration availability. ${snapshot.error}'
                            : 'Self-registration is currently disabled by your administrator.',
                      ),
                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: () => setState(() {
                          _availability = _registration.availability();
                        }),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
          ),
        ),
      );
    },
  );
}
