package org.firstinspires.ftc.teamcode;

import androidx.annotation.NonNull;

import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Pose;
import com.bylazar.telemetry.PanelsTelemetry;
import com.qualcomm.robotcore.hardware.Gamepad;

import org.firstinspires.ftc.teamcode.subsystems.Drivetrain;
import org.firstinspires.ftc.teamcode.subsystems.FlowerBar;
import org.firstinspires.ftc.teamcode.subsystems.Intake;
import org.firstinspires.ftc.teamcode.subsystems.Shooter;
import org.firstinspires.ftc.teamcode.subsystems.Transfer;
import org.firstinspires.ftc.teamcode.subsystems.Turret;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.NextRobot;
import dev.nextftc.robot.Telemetry;
import dev.nextftc.robot.triggers.CommandGamepad;
import dev.nextftc.robot.triggers.Trigger;

public class Robot implements NextRobot {
    public enum State {
        IDLE,
        INTAKE,
        SHOOT,
        UNJAM
    }

    public final Intake intake = new Intake();
    public final Turret turret = new Turret();
    public final Shooter shooter = new Shooter();
    public final Transfer transfer = new Transfer();
    public final Drivetrain drivetrain = new Drivetrain();
    public final FlowerBar flowerBar = new FlowerBar();

    private State state = State.IDLE;
    private Alliance alliance = Alliance.RED;

    public void initialize(Pose startPose, Alliance alliance) {
        this.alliance = alliance;
        // This Robot object outlives each opmode, so start every opmode from IDLE.
        state = State.IDLE;
        ShotCalculator.reset();
        Telemetry.addBackend(PanelsTelemetry.INSTANCE.getFtcTelemetry());
        drivetrain.initialize(startPose);
        intake.initialize();
        turret.initialize();
        shooter.initialize();
        transfer.initialize();
        flowerBar.initialize();
    }

    private Command stateCommand(State target) {
        switch (target) {
            case IDLE:
                return Groups.sequential(
                        intake.set(Intake.State.OFF),
                        shooter.set(Shooter.State.IDLE),
                        transfer.set(Transfer.State.OFF));
            case INTAKE:
                return Groups.sequential(
                        intake.set(Intake.State.INTAKE),
                        shooter.set(Shooter.State.INTAKE),
                        transfer.set(Transfer.State.LOAD));
            case SHOOT:
                return Groups.sequential(
                        intake.set(Intake.State.OFF),
                        transfer.set(Transfer.State.OFF),
                        shooter.set(Shooter.State.REV),
                        Commands.waitUntil(shooter::atSpeed),
                        transfer.set(Transfer.State.OPEN),
                        Commands.waitMs(Constants.Transfer.stopperOpenDelayMs),
                        intake.set(Intake.State.INTAKE),
                        transfer.set(Transfer.State.FEED));
            case UNJAM:
                return Groups.sequential(
                        intake.set(Intake.State.UNJAM),
                        shooter.set(Shooter.State.UNJAM),
                        transfer.set(Transfer.State.UNJAM));
            default:
                throw new IllegalStateException("No command for state " + target);
        }
    }

    public void configureBindings(Gamepad gamepad) {
        configureBindings(gamepad, ShotCalculator.RPM_STEP, true);
    }

    /**
     * Driver controls shared by teleop and the LUT tuner.
     * @param rpmStep how much dpad up/down changes the shooter RPM
     * @param dpadTrimsTurret false frees dpad left/right for the caller
     */
    public void configureBindings(Gamepad gamepad, double rpmStep, boolean dpadTrimsTurret) {
        CommandGamepad controller = new CommandGamepad(gamepad);

        controller.leftBumper()
                .onTrue(set(State.INTAKE))
                .onFalse(set(State.IDLE));

        controller.rightBumper()
                .onTrue(set(State.SHOOT))
                .onFalse(set(State.IDLE));

        controller.b()
                .onTrue(set(State.UNJAM))
                .onFalse(set(State.IDLE));

        controller.x().onTrue(drivetrain.resetFieldCentric(alliance));
        controller.a().onTrue(drivetrain.resetPose(Utilities.resetPose(alliance)));
        controller.y().onTrue(flowerBar.toggle());
        new Trigger(() -> gamepad.guide).onTrue(turret.toggleLock());
        new Trigger(() -> gamepad.dpad_up).onTrue(Commands.instant(() -> ShotCalculator.adjustRpm(rpmStep)));
        new Trigger(() -> gamepad.dpad_down).onTrue(Commands.instant(() -> ShotCalculator.adjustRpm(-rpmStep)));
        if (dpadTrimsTurret) {
            // Testing: nudge turret aim 1 degree per press (left = CCW, right = CW).
            new Trigger(() -> gamepad.dpad_left).onTrue(turret.adjustTrim(1.0));
            new Trigger(() -> gamepad.dpad_right).onTrue(turret.adjustTrim(-1.0));
        }

        drivetrain.drive(gamepad, alliance, this::headingAssistActive).schedule();
    }

    /** Teleop only (auto never schedules drive): straighten up while intaking off the floor. */
    private boolean headingAssistActive() {
        return state == State.INTAKE && flowerBar.getState() == FlowerBar.State.DOWN;
    }

    public State getState() {
        return state;
    }

    public Command set(State target) {
        return Groups.sequential(
                Commands.instant(() -> state = target).requiring(this),
                stateCommand(target)
        );
    }

    @Override
    public void periodic() {
        updateShot();
        logTelemetry();
    }

    public void disabledPeriodic() {
        updateShot();
        drivetrain.periodic();
        // Mechanism periodics don't run during init, so tick transfer here to close the stopper (motor stays OFF)
        transfer.periodic();
        logTelemetry();
    }

    private void logTelemetry() {
        Telemetry.log("state", state);
        // Shot RPM even while idle, so the LUT target is always visible
        String offset = ShotCalculator.useLut && ShotCalculator.rpmOffset != 0
                ? String.format(java.util.Locale.US, " (%+.0f)", ShotCalculator.rpmOffset) : "";
        Telemetry.log("target rpm", String.format(java.util.Locale.US, "%.0f", ShotCalculator.shooterRpm) + offset);
        Telemetry.log("current rpm", shooter.getRpm());
        Telemetry.log("goal distance (in)", ShotCalculator.distance);
    }

    private void updateShot() {
        Follower follower = drivetrain.getFollower();
        if (follower != null) ShotCalculator.update(follower, alliance);
    }

    @NonNull
    @Override
    public Set<Mechanism> getMechanisms() {
        return new LinkedHashSet<>(Arrays.asList(drivetrain, intake, turret, shooter, transfer, flowerBar));
    }
}
