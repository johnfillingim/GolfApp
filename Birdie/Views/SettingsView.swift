import SwiftData
import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context

    @State private var hapticsOn = HapticPlayer.shared.isEnabled
    @State private var soundOn = SoundPlayer.shared.isEnabled

    var body: some View {
        NavigationStack {
            List {
                Section("Profile") {
                    if let me = AuthService.myProfile(context: context) {
                        HStack {
                            PlayerAvatar(emoji: me.emoji, size: 40)
                            VStack(alignment: .leading) {
                                Text(me.name)
                                if let handicap = me.handicapIndex {
                                    Text("Handicap index \(String(format: "%.1f", handicap))")
                                        .font(Theme.Typo.caption)
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                }
                            }
                            Spacer()
                            if me.appleUserID != nil {
                                TagChip(text: " Apple", color: Theme.Colors.neutral)
                            }
                        }
                    }
                }

                Section("Feel") {
                    Toggle("Haptics", isOn: $hapticsOn)
                        .onChange(of: hapticsOn) { _, value in
                            HapticPlayer.shared.isEnabled = value
                            if value { HapticPlayer.shared.confirm() }
                        }
                    Toggle("Celebration sounds", isOn: $soundOn)
                        .onChange(of: soundOn) { _, value in
                            SoundPlayer.shared.isEnabled = value
                        }
                    Text("Sounds respect the ring/silent switch. Reduce Motion in system settings swaps particle effects for gentle fades.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }

                Section("Sync") {
                    HStack {
                        Text("Live round sharing")
                        Spacer()
                        switch env.sync.status {
                        case .localOnly:
                            TagChip(text: "THIS PHONE ONLY", color: Theme.Colors.neutral)
                        case .idle:
                            TagChip(text: "iCLOUD", color: Theme.Colors.money)
                        case .syncing:
                            TagChip(text: "SYNCING…", color: Theme.Colors.money)
                        case .waitingForNetwork:
                            TagChip(text: "OFFLINE — QUEUED", color: Theme.Colors.neutral)
                        case .error:
                            TagChip(text: "ERROR", color: Theme.Colors.down)
                        }
                    }
                    if case .localOnly = env.sync.status {
                        Text("Sign into iCloud to share rounds so everyone scores on their own phone. Everything works offline either way.")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }

                Section {
                    Text("Birdie tracks bets and computes who owes whom. It never holds, transfers, or processes money — settle up in cash or your payment app of choice.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                } header: {
                    Text("The fine print")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.Colors.background)
            .navigationTitle("Settings")
        }
    }
}
