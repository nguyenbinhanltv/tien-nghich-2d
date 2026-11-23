import UIKit
import Capacitor

/// The game's one screen: the Capacitor web view, full screen, no status bar; edge swipes need a second swipe so a dodge near the screen edge does not leave the game.

class GameViewController: CAPBridgeViewController {
    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom, .left, .right] }
}
